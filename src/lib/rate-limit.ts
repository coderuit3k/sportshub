import { NextResponse } from "next/server";

/**
 * Dependency-free sliding-window rate limiter.
 *
 * Design notes (honest limitations):
 * - State lives in a module-level Map, i.e. PER SERVER INSTANCE. On serverless
 *   (Vercel) each warm instance keeps its own counters, so the effective global
 *   limit is roughly `limit × number of concurrent instances`. This is a
 *   best-effort brake against credential stuffing / signup spam, not a hard
 *   global quota.
 * - The core (`SlidingWindowLimiter`) is pure and clock-injectable so it is
 *   unit-testable and so the storage can later be swapped for a shared store
 *   (Upstash Redis / Vercel KV) behind the same check/record/reset surface
 *   without touching route handlers.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Attempts remaining in the current window (0 when denied). */
  remaining: number;
  /** Seconds the client should wait before retrying (0 when allowed). */
  retryAfterSeconds: number;
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    /** Max attempts allowed inside the window. */
    private readonly limit: number,
    /** Window length in milliseconds. */
    private readonly windowMs: number,
  ) {}

  private prune(key: string, now: number): number[] {
    const cutoff = now - this.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length === 0) this.hits.delete(key);
    else this.hits.set(key, kept);
    return kept;
  }

  /** Peek at the decision for `key` WITHOUT recording an attempt. */
  check(key: string, now: number = Date.now()): RateLimitDecision {
    const kept = this.prune(key, now);
    if (kept.length < this.limit) {
      return { allowed: true, remaining: this.limit - kept.length, retryAfterSeconds: 0 };
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((kept[0] + this.windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  /** Record one attempt for `key` (call after a failed login, etc.). */
  record(key: string, now: number = Date.now()): void {
    const kept = this.prune(key, now);
    kept.push(now);
    this.hits.set(key, kept);
  }

  /** Check and, when allowed, record the attempt in one step. */
  consume(key: string, now: number = Date.now()): RateLimitDecision {
    const decision = this.check(key, now);
    if (decision.allowed) {
      this.record(key, now);
      return { ...decision, remaining: decision.remaining - 1 };
    }
    return decision;
  }

  /** Forget all attempts for `key` (e.g. after a successful login). */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Number of keys currently tracked (diagnostics/tests). */
  get size(): number {
    return this.hits.size;
  }
}

/** First hop of `x-forwarded-for` (set by Vercel / reverse proxies), else a stable fallback. */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Standard 429 response: Vietnamese message + Retry-After header. */
export function tooManyRequests(decision: RateLimitDecision): NextResponse {
  return NextResponse.json(
    { error: "Bạn đã thử quá nhiều lần. Vui lòng đợi ít phút rồi thử lại.", code: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
  );
}

/**
 * Shared per-instance limiters (module singletons so counters survive across
 * requests handled by the same warm instance).
 *
 * - login: only FAILED attempts are recorded (see login route) — 10 failures
 *   per 10 minutes per IP+email, reset on success. Legit users are never
 *   locked out by their own successful logins.
 * - register: every attempt counts — 5 per hour per IP.
 * - booking: every creation attempt counts — 30 per 10 minutes per user.
 */
export const loginLimiter = new SlidingWindowLimiter(10, 10 * 60_000);
export const registerLimiter = new SlidingWindowLimiter(5, 60 * 60_000);
export const bookingLimiter = new SlidingWindowLimiter(30, 10 * 60_000);
