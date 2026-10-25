import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Sliding-window rate limiting with two interchangeable backends behind one
 * async surface (`check` / `record` / `consume` / `reset`):
 *
 * - **Upstash** (shared, global) — used when `KV_REST_API_URL` and
 *   `KV_REST_API_TOKEN` are set (the names injected by the Vercel
 *   Marketplace Upstash/Redis integration; Vercel KV speaks the Upstash
 *   REST protocol, so `@upstash/redis` talks to it directly). Counters live
 *   in Redis, so the quota is enforced across every serverless instance.
 *   Backed by `@upstash/ratelimit`'s sliding-window algorithm.
 * - **In-memory** (fallback) — the original per-instance `SlidingWindowLimiter`
 *   (module-level Map). Used for local dev and until the Upstash env vars are
 *   provisioned. Honest limitation: on serverless each warm instance keeps its
 *   own counters, so the effective global limit is roughly
 *   `limit × concurrent instances` — a best-effort brake, not a hard quota.
 *   A one-time warning is logged when this fallback is active in production.
 *
 * If an Upstash call itself fails (network/outage), that call degrades to the
 * in-memory backend rather than failing the request: login/signup/booking
 * stay available and still get per-instance braking.
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

/* ------------------------------------------------------------------ */
/* Backends                                                            */
/* ------------------------------------------------------------------ */

export type RateLimitBackendKind = "memory" | "upstash";

/**
 * Resolve the Upstash REST credentials from the environment — exactly the
 * `KV_REST_API_URL` / `KV_REST_API_TOKEN` pair the Vercel Marketplace
 * integration injects. Returns null unless BOTH resolve to non-empty values.
 */
export function resolveUpstashCredentials(
  env: NodeJS.ProcessEnv = process.env,
): { url: string; token: string } | null {
  const url = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

/** Backend selection: Upstash only when a full REST url/token pair resolves. */
export function rateLimitBackendKind(env: NodeJS.ProcessEnv = process.env): RateLimitBackendKind {
  return resolveUpstashCredentials(env) ? "upstash" : "memory";
}

interface RateLimitBackend {
  check(key: string): Promise<RateLimitDecision>;
  record(key: string): Promise<void>;
  consume(key: string): Promise<RateLimitDecision>;
  reset(key: string): Promise<void>;
}

/** In-memory backend: exact original semantics via `SlidingWindowLimiter`. */
class MemoryRateLimitBackend implements RateLimitBackend {
  private readonly inner: SlidingWindowLimiter;
  constructor(limit: number, windowMs: number) {
    this.inner = new SlidingWindowLimiter(limit, windowMs);
  }
  async check(key: string): Promise<RateLimitDecision> {
    return this.inner.check(key);
  }
  async record(key: string): Promise<void> {
    this.inner.record(key);
  }
  async consume(key: string): Promise<RateLimitDecision> {
    return this.inner.consume(key);
  }
  async reset(key: string): Promise<void> {
    this.inner.reset(key);
  }
}

/** `@upstash/ratelimit` Duration string for a millisecond window. */
function toUpstashWindow(windowMs: number): string {
  if (windowMs % 3_600_000 === 0) return `${windowMs / 3_600_000} h`;
  if (windowMs % 60_000 === 0) return `${windowMs / 60_000} m`;
  if (windowMs % 1_000 === 0) return `${windowMs / 1_000} s`;
  return `${windowMs} ms`;
}

function decisionFromReset(remaining: number, resetEpochMs: number): RateLimitDecision {
  if (remaining > 0) return { allowed: true, remaining, retryAfterSeconds: 0 };
  const retryAfterSeconds = Math.max(1, Math.ceil((resetEpochMs - Date.now()) / 1000));
  return { allowed: false, remaining: 0, retryAfterSeconds };
}

/**
 * Upstash backend. Semantics mapping onto `@upstash/ratelimit`:
 * - `check`  → `getRemaining()` (a true peek — consumes nothing).
 * - `record` → `limit()` with the decision discarded (counts one attempt).
 * - `consume`→ `limit()`.
 * - `reset`  → `resetUsedTokens()`.
 * Delta vs the in-memory limiter: Upstash's sliding window is a weighted
 * two-bucket approximation rather than an exact timestamp log, so counts
 * near a window boundary can differ by a small margin; quotas are the same.
 * Any Upstash error degrades that call to the in-memory fallback.
 */
class UpstashRateLimitBackend implements RateLimitBackend {
  private ratelimit: Ratelimit | null = null;
  private readonly fallback: MemoryRateLimitBackend;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly prefix: string,
    private readonly url: string,
    private readonly token: string,
  ) {
    this.fallback = new MemoryRateLimitBackend(limit, windowMs);
  }

  private get client(): Ratelimit {
    if (!this.ratelimit) {
      this.ratelimit = new Ratelimit({
        redis: new Redis({ url: this.url, token: this.token }),
        limiter: Ratelimit.slidingWindow(this.limit, toUpstashWindow(this.windowMs) as Parameters<typeof Ratelimit.slidingWindow>[1]),
        prefix: this.prefix,
        analytics: false,
        timeout: 2_000,
      });
    }
    return this.ratelimit;
  }

  async check(key: string): Promise<RateLimitDecision> {
    try {
      const { remaining, reset } = await this.client.getRemaining(key);
      return decisionFromReset(remaining, reset);
    } catch {
      return this.fallback.check(key);
    }
  }

  async record(key: string): Promise<void> {
    try {
      await this.client.limit(key);
    } catch {
      await this.fallback.record(key);
    }
  }

  async consume(key: string): Promise<RateLimitDecision> {
    try {
      const res = await this.client.limit(key);
      if (res.success) return { allowed: true, remaining: res.remaining, retryAfterSeconds: 0 };
      return decisionFromReset(0, res.reset);
    } catch {
      return this.fallback.consume(key);
    }
  }

  async reset(key: string): Promise<void> {
    try {
      await this.client.resetUsedTokens(key);
    } catch {
      await this.fallback.reset(key);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Facade + shared limiters                                            */
/* ------------------------------------------------------------------ */

export interface RateLimiterConfig {
  /** Max attempts allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Key prefix isolating this limiter's counters in the shared store. */
  prefix: string;
}

let warnedAboutMemoryFallback = false;
let loggedUpstashBackend = false;

/**
 * A rate limiter with async `check` / `record` / `consume` / `reset`.
 * The backend is chosen lazily on first use from the environment
 * (Upstash when configured, in-memory otherwise — see file header).
 */
export class SharedRateLimiter implements RateLimitBackend {
  private backend: RateLimitBackend | null = null;

  constructor(
    private readonly config: RateLimiterConfig,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /** Which backend this limiter will use (decided from env; exposed for tests/diagnostics). */
  get backendKind(): RateLimitBackendKind {
    return rateLimitBackendKind(this.env);
  }

  private get resolved(): RateLimitBackend {
    if (!this.backend) {
      const credentials = resolveUpstashCredentials(this.env);
      if (credentials) {
        if (!loggedUpstashBackend) {
          loggedUpstashBackend = true;
          // Info-level proof in production logs of which backend is live.
          // Never log the credential values themselves.
          console.info("[rate-limit] backend: upstash");
        }
        this.backend = new UpstashRateLimitBackend(
          this.config.limit,
          this.config.windowMs,
          this.config.prefix,
          credentials.url,
          credentials.token,
        );
      } else {
        if (this.env.NODE_ENV === "production" && !warnedAboutMemoryFallback) {
          warnedAboutMemoryFallback = true;
          console.warn(
            "[rate-limit] KV_REST_API_URL / KV_REST_API_TOKEN are not set — " +
              "falling back to per-instance in-memory rate limiting (not a global quota).",
          );
        }
        this.backend = new MemoryRateLimitBackend(this.config.limit, this.config.windowMs);
      }
    }
    return this.backend;
  }

  check(key: string): Promise<RateLimitDecision> {
    return this.resolved.check(key);
  }
  record(key: string): Promise<void> {
    return this.resolved.record(key);
  }
  consume(key: string): Promise<RateLimitDecision> {
    return this.resolved.consume(key);
  }
  reset(key: string): Promise<void> {
    return this.resolved.reset(key);
  }
}

export function createRateLimiter(config: RateLimiterConfig, env?: NodeJS.ProcessEnv): SharedRateLimiter {
  return new SharedRateLimiter(config, env);
}

/**
 * Shared limiters (module singletons so in-memory counters survive across
 * requests handled by the same warm instance; with Upstash configured the
 * counters are global in Redis).
 *
 * - login: only FAILED attempts are recorded (see login route) — 10 failures
 *   per 10 minutes per IP+email, reset on success. Legit users are never
 *   locked out by their own successful logins.
 * - register: every attempt counts — 5 per hour per IP.
 * - booking: every creation attempt counts — 30 per 10 minutes per user.
 */
export const loginLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60_000, prefix: "sportshub:login" });
export const registerLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60_000, prefix: "sportshub:register" });
export const bookingLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60_000, prefix: "sportshub:booking" });
