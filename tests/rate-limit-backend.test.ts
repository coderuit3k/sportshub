import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Backend selection + Redis path for the shared rate limiters.
 * `@upstash/redis` is mocked with an in-memory fake implementing the
 * exact commands the backend issues (GET / INCR / PEXPIRE / PTTL / DEL)
 * over a Map with real expiry timestamps — NO real network calls.
 * A static `failMode` switch makes every command throw, to exercise the
 * degraded path (error logged + in-memory fallback + diagnostics).
 */

vi.mock("@upstash/redis", () => {
  class FakeRedis {
    static instances: FakeRedis[] = [];
    static failMode = false;
    private store = new Map<string, { value: number; expiresAt: number | null }>();
    constructor(public config: { url: string; token: string }) {
      FakeRedis.instances.push(this);
    }
    private guard(): void {
      if (FakeRedis.failMode) throw new Error("upstash unreachable");
    }
    private live(key: string): { value: number; expiresAt: number | null } | undefined {
      const entry = this.store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
        this.store.delete(key);
        return undefined;
      }
      return entry;
    }
    /** Test-only introspection: the raw keys currently held. */
    keys(): string[] {
      return [...this.store.keys()].filter((k) => this.live(k));
    }
    async get(key: string): Promise<number | null> {
      this.guard();
      const entry = this.live(key);
      return entry ? entry.value : null;
    }
    async incr(key: string): Promise<number> {
      this.guard();
      const entry = this.live(key);
      if (!entry) {
        this.store.set(key, { value: 1, expiresAt: null });
        return 1;
      }
      entry.value += 1;
      return entry.value;
    }
    async pexpire(key: string, ms: number): Promise<number> {
      this.guard();
      const entry = this.live(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + ms;
      return 1;
    }
    async pttl(key: string): Promise<number> {
      this.guard();
      const entry = this.live(key);
      if (!entry) return -2;
      if (entry.expiresAt === null) return -1;
      return Math.max(0, entry.expiresAt - Date.now());
    }
    async del(key: string): Promise<number> {
      this.guard();
      const existed = this.live(key) ? 1 : 0;
      this.store.delete(key);
      return existed;
    }
  }
  return { Redis: FakeRedis };
});

import { createRateLimiter, rateLimitBackendKind, rateLimitHeaders, resolveUpstashCredentials } from "@/lib/rate-limit";
import { Redis } from "@upstash/redis";

const FakeRedis = Redis as unknown as {
  instances: Array<{ config: { url: string; token: string }; keys: () => string[] }>;
  failMode: boolean;
};

beforeEach(() => {
  FakeRedis.instances.length = 0;
  FakeRedis.failMode = false;
});

const KV_ENV = {
  NODE_ENV: "test",
  KV_REST_API_URL: "https://fake-kv.vercel.app",
  KV_REST_API_TOKEN: "kv-token",
} as NodeJS.ProcessEnv;

const asEnv = (partial: Record<string, string>) => partial as unknown as NodeJS.ProcessEnv;
const noEnv = () => ({ NODE_ENV: "test" }) as unknown as NodeJS.ProcessEnv;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("rateLimitBackendKind / resolveUpstashCredentials", () => {
  it("selects upstash when the full KV_* pair is present", () => {
    expect(rateLimitBackendKind(KV_ENV)).toBe("upstash");
    expect(resolveUpstashCredentials(KV_ENV)).toEqual({
      url: "https://fake-kv.vercel.app",
      token: "kv-token",
    });
  });

  it("falls back to memory when only one half of the KV pair is present", () => {
    expect(rateLimitBackendKind(asEnv({ KV_REST_API_URL: "https://x" }))).toBe("memory");
    expect(rateLimitBackendKind(asEnv({ KV_REST_API_TOKEN: "t" }))).toBe("memory");
    expect(resolveUpstashCredentials(asEnv({ KV_REST_API_URL: "https://x" }))).toBeNull();
    expect(resolveUpstashCredentials(asEnv({ KV_REST_API_TOKEN: "t" }))).toBeNull();
  });

  it("falls back to memory when nothing is set", () => {
    expect(rateLimitBackendKind(asEnv({}))).toBe("memory");
    expect(resolveUpstashCredentials(asEnv({}))).toBeNull();
  });
});

describe("SharedRateLimiter — in-memory fallback (no env)", () => {
  it("enforces the quota via consume", async () => {
    const lim = createRateLimiter({ limit: 2, windowMs: 60_000, prefix: "t:memory" }, noEnv());
    expect(lim.backendKind).toBe("memory");
    expect((await lim.consume("k")).allowed).toBe(true);
    expect((await lim.consume("k")).allowed).toBe(true);
    const denied = await lim.consume("k");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("check peeks, record counts, reset clears (login semantics)", async () => {
    const lim = createRateLimiter({ limit: 1, windowMs: 60_000, prefix: "t:login" }, noEnv());
    expect((await lim.check("u")).allowed).toBe(true);
    expect((await lim.check("u")).allowed).toBe(true); // peek recorded nothing
    await lim.record("u");
    expect((await lim.check("u")).allowed).toBe(false);
    await lim.reset("u");
    expect((await lim.check("u")).allowed).toBe(true);
  });

  it("diagnostics report memory configuration and never degraded", async () => {
    const lim = createRateLimiter({ limit: 1, windowMs: 60_000, prefix: "t:diag-memory" }, noEnv());
    expect(lim.diagnostics()).toEqual({ configured: "memory", degradedLastCall: false });
    await lim.consume("k");
    expect(lim.diagnostics()).toEqual({ configured: "memory", degradedLastCall: false });
  });

  it("warns once when the memory fallback is used in production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
      const a = createRateLimiter({ limit: 1, windowMs: 1_000, prefix: "t:warn-a" }, env);
      const b = createRateLimiter({ limit: 1, windowMs: 1_000, prefix: "t:warn-b" }, env);
      await a.check("k");
      await b.check("k");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("in-memory");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("SharedRateLimiter — Redis backend (fake @upstash/redis)", () => {
  it("builds a Redis client with the KV credentials on first use and logs the backend once", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const lim = createRateLimiter({ limit: 10, windowMs: 10 * 60_000, prefix: "sportshub:login" }, KV_ENV);
      expect(lim.backendKind).toBe("upstash");
      await lim.check("login:1.2.3.4:a@b.c");
      expect(info).toHaveBeenCalledWith("[rate-limit] backend: upstash");
    } finally {
      info.mockRestore();
    }
    expect(FakeRedis.instances).toHaveLength(1);
    expect(FakeRedis.instances[0].config).toEqual({ url: "https://fake-kv.vercel.app", token: "kv-token" });
  });

  it("stores counters under rl:{prefix}:{key}", async () => {
    const lim = createRateLimiter({ limit: 5, windowMs: 60_000, prefix: "sportshub:login" }, KV_ENV);
    await lim.record("login:1.2.3.4:a@b.c");
    expect(FakeRedis.instances).toHaveLength(1);
    expect(FakeRedis.instances[0].keys()).toEqual(["rl:sportshub:login:login:1.2.3.4:a@b.c"]);
  });

  it("record/check count to the limit, then deny with a sane retryAfter", async () => {
    const lim = createRateLimiter({ limit: 3, windowMs: 60_000, prefix: "t:redis-login" }, KV_ENV);
    // Peeking never eats quota.
    expect((await lim.check("u")).remaining).toBe(3);
    expect((await lim.check("u")).remaining).toBe(3);
    await lim.record("u");
    expect((await lim.check("u")).remaining).toBe(2);
    await lim.record("u");
    await lim.record("u");
    const blocked = await lim.check("u");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    // reset clears the counter.
    await lim.reset("u");
    const after = await lim.check("u");
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(3);
  });

  it("consume counts exactly to the limit under sequential calls", async () => {
    const lim = createRateLimiter({ limit: 3, windowMs: 60_000, prefix: "t:redis-consume" }, KV_ENV);
    const r1 = await lim.consume("k");
    expect(r1).toMatchObject({ allowed: true, remaining: 2 });
    const r2 = await lim.consume("k");
    expect(r2).toMatchObject({ allowed: true, remaining: 1 });
    const r3 = await lim.consume("k");
    expect(r3).toMatchObject({ allowed: true, remaining: 0 });
    const r4 = await lim.consume("k");
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterSeconds).toBeGreaterThan(0);
    expect(r4.retryAfterSeconds).toBeLessThanOrEqual(60);
    // Over-limit consumes keep counting but stay denied (fixed window).
    const r5 = await lim.consume("k");
    expect(r5.allowed).toBe(false);
  });

  it("the fixed window expires: counting restarts after windowMs", async () => {
    const lim = createRateLimiter({ limit: 1, windowMs: 60, prefix: "t:redis-expiry" }, KV_ENV);
    await lim.record("u");
    expect((await lim.check("u")).allowed).toBe(false);
    await sleep(90);
    const after = await lim.check("u");
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(1);
  });

  it("diagnostics report upstash and not-degraded while Redis answers", async () => {
    const lim = createRateLimiter({ limit: 2, windowMs: 60_000, prefix: "t:diag-upstash" }, KV_ENV);
    expect(lim.diagnostics()).toEqual({ configured: "upstash", degradedLastCall: false });
    await lim.consume("k");
    expect(lim.diagnostics()).toEqual({ configured: "upstash", degradedLastCall: false });
  });

  it("a Redis error is logged, degrades the call to memory, and diagnostics reflect it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const lim = createRateLimiter({ limit: 1, windowMs: 60_000, prefix: "t:redis-down" }, KV_ENV);
      // Healthy first: Redis answers, not degraded.
      expect((await lim.consume("k")).allowed).toBe(true);
      expect(lim.diagnostics()).toEqual({ configured: "upstash", degradedLastCall: false });

      FakeRedis.failMode = true;
      // consume() must not throw — the memory fallback answers instead.
      const degraded = await lim.consume("k");
      expect(degraded.allowed).toBe(true); // memory fallback has its own fresh count
      expect(error).toHaveBeenCalled();
      expect(String(error.mock.calls[0][0])).toContain("[rate-limit] redis error");
      expect(lim.diagnostics()).toEqual({ configured: "upstash", degradedLastCall: true });
      // The memory fallback enforces its own quota while Redis is down.
      const second = await lim.consume("k");
      expect(second.allowed).toBe(false);

      // Recovery: Redis answers again → degraded clears.
      FakeRedis.failMode = false;
      await lim.check("other");
      expect(lim.diagnostics()).toEqual({ configured: "upstash", degradedLastCall: false });
    } finally {
      error.mockRestore();
    }
  });
});

describe("rateLimitHeaders (TEMP-DIAGNOSTIC)", () => {
  it("reports the memory backend for a memory-configured limiter", async () => {
    const lim = createRateLimiter({ limit: 2, windowMs: 60_000, prefix: "t:hdr-memory" }, noEnv());
    const decision = await lim.consume("k");
    expect(rateLimitHeaders(lim, decision)).toEqual({
      "X-RateLimit-Backend": "memory",
      "X-RateLimit-Remaining": "1",
    });
  });

  it("reports upstash while Redis answers", async () => {
    const lim = createRateLimiter({ limit: 2, windowMs: 60_000, prefix: "t:hdr-upstash" }, KV_ENV);
    const decision = await lim.consume("k");
    expect(rateLimitHeaders(lim, decision)).toEqual({
      "X-RateLimit-Backend": "upstash",
      "X-RateLimit-Remaining": "1",
    });
  });

  it("reports upstash-degraded after a Redis error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const lim = createRateLimiter({ limit: 2, windowMs: 60_000, prefix: "t:hdr-degraded" }, KV_ENV);
      await lim.consume("k"); // healthy — Redis answers
      FakeRedis.failMode = true;
      const decision = await lim.consume("k"); // degraded — memory fallback answers
      expect(rateLimitHeaders(lim, decision)["X-RateLimit-Backend"]).toBe("upstash-degraded");
    } finally {
      error.mockRestore();
    }
  });
});
