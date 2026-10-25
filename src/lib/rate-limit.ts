import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

/**
 * Rate limiting with two interchangeable backends behind one async
 * surface (`check` / `record` / `consume` / `reset`):
 *
 * - **Upstash** (shared, global) — used when `KV_REST_API_URL` and
 *   `KV_REST_API_TOKEN` are set (the names injected by the Vercel
 *   Marketplace Upstash/Redis integration; Vercel KV speaks the Upstash
 *   REST protocol, so `@upstash/redis` talks to it directly). Counters
 *   live in Redis, so the quota is enforced across every serverless
 *   instance. Implemented as direct fixed-window counters on
 *   `@upstash/redis` commands — one key per limiter+subject,
 *   `rl:{prefix}:{key}`: `INCR` (+ `PEXPIRE` on the first hit) counts,
 *   `GET` peeks, `PTTL` sizes the retry delay, `DEL` resets.
 * - **In-memory** (fallback) — the original per-instance `SlidingWindowLimiter`
 *   (module-level Map). Used for local dev and until the Upstash env vars are
 *   provisioned. Honest limitation: on serverless each warm instance keeps its
 *   own counters, so the effective global limit is roughly
 *   `limit × concurrent instances` — a best-effort brake, not a hard quota.
 *   A one-time warning is logged when this fallback is active in production.
 *
 * Semantics delta between backends: the Redis counters are FIXED windows
 * anchored at the first attempt in the window; the in-memory limiter is an
 * exact sliding log. Quotas are identical either way.
 *
 * If a Redis call itself fails (network/outage), the error is logged
 * (`console.error`) and that call degrades to the in-memory backend rather
 * than failing the request: login/signup/booking stay available and still
 * get per-instance braking. The degradation is observable via
 * `SharedRateLimiter.diagnostics()` — silent failure is not acceptable
 * for a security control.
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

/** Coerce a Redis GET result (number, numeric string, or null) to a count. */
function toCount(raw: number | string | null | undefined): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === "string") {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Upstash backend: direct fixed-window counters via `@upstash/redis`.
 *
 * One Redis key per limiter+subject: `rl:{prefix}:{key}`.
 * - `record`  → `INCR`; when the count is 1 (first hit of a window),
 *   `PEXPIRE` the key to `windowMs`, anchoring the fixed window.
 * - `check`   → `GET` the counter (missing = 0) WITHOUT counting; when
 *   denied, `PTTL` sizes `retryAfterSeconds` (falling back to the full
 *   window when PTTL is -1/-2).
 * - `consume` → `INCR` first, then decide from the new count
 *   (`allowed = count <= limit`), so concurrent consumers cannot
 *   overshoot the quota the way a check-then-record pair could.
 * - `reset`   → `DEL` the counter.
 *
 * Any Redis error is logged and degrades THAT call to the in-memory
 * fallback; `degradedLastCall` records whether the most recent call had
 * to degrade, so the facade can surface it (see `diagnostics()`).
 */
class UpstashRateLimitBackend implements RateLimitBackend {
  private redis: Redis | null = null;
  private readonly fallback: MemoryRateLimitBackend;
  /** True when the most recent call degraded to memory after a Redis error. */
  degradedLastCall = false;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly prefix: string,
    private readonly url: string,
    private readonly token: string,
  ) {
    this.fallback = new MemoryRateLimitBackend(limit, windowMs);
  }

  private get client(): Redis {
    if (!this.redis) {
      this.redis = new Redis({ url: this.url, token: this.token });
    }
    return this.redis;
  }

  private redisKey(key: string): string {
    return `rl:${this.prefix}:${key}`;
  }

  /** Seconds to wait from a PTTL value; -1/-2 (no expiry / no key) → full window. */
  private retryAfterSeconds(pttl: number): number {
    if (pttl > 0) return Math.max(1, Math.ceil(pttl / 1000));
    return Math.max(1, Math.ceil(this.windowMs / 1000));
  }

  private markDegraded(err: unknown): void {
    // Message only — never log credentials or request config.
    console.error("[rate-limit] redis error", err instanceof Error ? err.message : String(err));
    this.degradedLastCall = true;
  }

  async check(key: string): Promise<RateLimitDecision> {
    try {
      const rk = this.redisKey(key);
      const count = toCount(await this.client.get<number | string>(rk));
      if (count < this.limit) {
        this.degradedLastCall = false;
        return { allowed: true, remaining: this.limit - count, retryAfterSeconds: 0 };
      }
      const pttl = await this.client.pttl(rk);
      this.degradedLastCall = false;
      return { allowed: false, remaining: 0, retryAfterSeconds: this.retryAfterSeconds(pttl) };
    } catch (err) {
      this.markDegraded(err);
      return this.fallback.check(key);
    }
  }

  async record(key: string): Promise<void> {
    try {
      const rk = this.redisKey(key);
      const count = await this.client.incr(rk);
      if (count === 1) await this.client.pexpire(rk, this.windowMs);
      this.degradedLastCall = false;
    } catch (err) {
      this.markDegraded(err);
      await this.fallback.record(key);
    }
  }

  async consume(key: string): Promise<RateLimitDecision> {
    try {
      const rk = this.redisKey(key);
      const count = await this.client.incr(rk);
      if (count === 1) await this.client.pexpire(rk, this.windowMs);
      if (count <= this.limit) {
        this.degradedLastCall = false;
        return { allowed: true, remaining: this.limit - count, retryAfterSeconds: 0 };
      }
      const pttl = await this.client.pttl(rk);
      this.degradedLastCall = false;
      return { allowed: false, remaining: 0, retryAfterSeconds: this.retryAfterSeconds(pttl) };
    } catch (err) {
      this.markDegraded(err);
      return this.fallback.consume(key);
    }
  }

  async reset(key: string): Promise<void> {
    try {
      await this.client.del(this.redisKey(key));
      this.degradedLastCall = false;
    } catch (err) {
      this.markDegraded(err);
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

/** Observable backend state for one limiter (see `SharedRateLimiter.diagnostics`). */
export interface RateLimitDiagnostics {
  /** Backend chosen from the environment: shared Redis, or per-instance memory. */
  configured: RateLimitBackendKind;
  /**
   * True when the most recent call had to degrade to the in-memory
   * fallback because Redis errored. Always false for a memory-configured
   * limiter and before the first call.
   */
  degradedLastCall: boolean;
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

  /**
   * Backend state WITHOUT forcing backend construction: which backend the
   * environment selects, and whether the most recent call degraded to
   * memory after a Redis error.
   */
  diagnostics(): RateLimitDiagnostics {
    const configured = rateLimitBackendKind(this.env);
    if (configured === "memory") return { configured, degradedLastCall: false };
    const backend = this.backend;
    return {
      configured,
      degradedLastCall: backend instanceof UpstashRateLimitBackend ? backend.degradedLastCall : false,
    };
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
 * TEMP-DIAGNOSTIC: remove after production verification.
 * Headers exposing which backend served a rate-limit gate and what the
 * gate decided, so the Redis path can be proven live from the outside
 * (response inspection) instead of by inference:
 * - `X-RateLimit-Backend`: `upstash` | `memory` | `upstash-degraded`
 *   (the last when the gate's most recent Redis call errored and the
 *   in-memory fallback answered).
 * - `X-RateLimit-Remaining`: the gate decision's remaining count.
 * Routes merge these into their gated responses (429 + rejections).
 */
export function rateLimitHeaders(
  limiter: SharedRateLimiter,
  decision: RateLimitDecision,
): Record<string, string> {
  const { configured, degradedLastCall } = limiter.diagnostics();
  return {
    "X-RateLimit-Backend":
      configured === "memory" ? "memory" : degradedLastCall ? "upstash-degraded" : "upstash",
    "X-RateLimit-Remaining": String(decision.remaining),
  };
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
