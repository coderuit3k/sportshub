import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Backend selection + Upstash path for the shared rate limiters.
 * Both Upstash modules are mocked — NO real network calls happen here.
 * The fake Ratelimit simulates a token counter per identifier so the
 * facade's semantics mapping (check=peek, record=consume, reset=clear)
 * can be asserted end to end.
 */

vi.mock("@upstash/redis", () => {
  class FakeRedis {
    static instances: FakeRedis[] = [];
    constructor(public config: { url: string; token: string }) {
      FakeRedis.instances.push(this);
    }
  }
  return { Redis: FakeRedis };
});

vi.mock("@upstash/ratelimit", () => {
  class FakeRatelimit {
    static instances: FakeRatelimit[] = [];
    static slidingWindow = vi.fn((tokens: number, window: string) => ({ tokens, window }));
    private used = new Map<string, number>();
    constructor(public config: { limiter: { tokens: number; window: string }; prefix?: string }) {
      FakeRatelimit.instances.push(this);
    }
    private get max(): number {
      return this.config.limiter.tokens;
    }
    async limit(identifier: string) {
      const n = (this.used.get(identifier) ?? 0) + 1;
      this.used.set(identifier, n);
      return {
        success: n <= this.max,
        limit: this.max,
        remaining: Math.max(0, this.max - n),
        reset: Date.now() + 60_000,
        pending: Promise.resolve(),
      };
    }
    async getRemaining(identifier: string) {
      const n = this.used.get(identifier) ?? 0;
      return { remaining: Math.max(0, this.max - n), reset: Date.now() + 60_000, limit: this.max };
    }
    async resetUsedTokens(identifier: string) {
      this.used.delete(identifier);
    }
  }
  return { Ratelimit: FakeRatelimit };
});

import { createRateLimiter, rateLimitBackendKind } from "@/lib/rate-limit";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const FakeRatelimit = Ratelimit as unknown as {
  instances: Array<{ config: { prefix?: string; limiter: { tokens: number; window: string } } }>;
  slidingWindow: ReturnType<typeof vi.fn>;
};
const FakeRedis = Redis as unknown as { instances: Array<{ config: { url: string; token: string } }> };

const UPSTASH_ENV = {
  NODE_ENV: "test",
  UPSTASH_REDIS_REST_URL: "https://fake.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "fake-token",
} as NodeJS.ProcessEnv;

beforeEach(() => {
  FakeRatelimit.instances.length = 0;
  FakeRedis.instances.length = 0;
  FakeRatelimit.slidingWindow.mockClear();
});

describe("rateLimitBackendKind", () => {
  it("selects upstash only when BOTH env vars are set", () => {
    expect(rateLimitBackendKind(UPSTASH_ENV)).toBe("upstash");
    expect(rateLimitBackendKind({ UPSTASH_REDIS_REST_URL: "https://x" } as unknown as NodeJS.ProcessEnv)).toBe("memory");
    expect(rateLimitBackendKind({ UPSTASH_REDIS_REST_TOKEN: "t" } as unknown as NodeJS.ProcessEnv)).toBe("memory");
    expect(rateLimitBackendKind({} as unknown as NodeJS.ProcessEnv)).toBe("memory");
  });
});

describe("SharedRateLimiter — in-memory fallback (no env)", () => {
  it("enforces the quota via consume", async () => {
    const lim = createRateLimiter({ limit: 2, windowMs: 60_000, prefix: "t:memory" }, {} as unknown as NodeJS.ProcessEnv);
    expect(lim.backendKind).toBe("memory");
    expect((await lim.consume("k")).allowed).toBe(true);
    expect((await lim.consume("k")).allowed).toBe(true);
    const denied = await lim.consume("k");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("check peeks, record counts, reset clears (login semantics)", async () => {
    const lim = createRateLimiter({ limit: 1, windowMs: 60_000, prefix: "t:login" }, {} as unknown as NodeJS.ProcessEnv);
    expect((await lim.check("u")).allowed).toBe(true);
    expect((await lim.check("u")).allowed).toBe(true); // peek recorded nothing
    await lim.record("u");
    expect((await lim.check("u")).allowed).toBe(false);
    await lim.reset("u");
    expect((await lim.check("u")).allowed).toBe(true);
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

describe("SharedRateLimiter — Upstash backend (mocked)", () => {
  it("builds a Ratelimit with the quota, window and prefix on first use", async () => {
    const lim = createRateLimiter({ limit: 10, windowMs: 10 * 60_000, prefix: "sportshub:login" }, UPSTASH_ENV);
    expect(lim.backendKind).toBe("upstash");
    await lim.check("login:1.2.3.4:a@b.c");
    expect(FakeRedis.instances).toHaveLength(1);
    expect(FakeRedis.instances[0].config).toEqual({ url: "https://fake.upstash.io", token: "fake-token" });
    expect(FakeRatelimit.slidingWindow).toHaveBeenCalledWith(10, "10 m");
    expect(FakeRatelimit.instances).toHaveLength(1);
    expect(FakeRatelimit.instances[0].config.prefix).toBe("sportshub:login");
  });

  it("consume maps the Upstash decision (allowed → denied at the quota)", async () => {
    const lim = createRateLimiter({ limit: 2, windowMs: 60_000, prefix: "t:upstash-consume" }, UPSTASH_ENV);
    expect((await lim.consume("k")).allowed).toBe(true);
    const second = await lim.consume("k");
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
    const denied = await lim.consume("k");
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("check() peeks without consuming; record() consumes; reset() clears", async () => {
    const lim = createRateLimiter({ limit: 2, windowMs: 60_000, prefix: "t:upstash-login" }, UPSTASH_ENV);
    // Peeking never eats quota.
    expect((await lim.check("u")).allowed).toBe(true);
    expect((await lim.check("u")).remaining).toBe(2);
    await lim.record("u");
    await lim.record("u");
    const blocked = await lim.check("u");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    await lim.reset("u");
    expect((await lim.check("u")).allowed).toBe(true);
    expect((await lim.check("u")).remaining).toBe(2);
  });

  it("degrades to the in-memory backend when Upstash errors", async () => {
    const lim = createRateLimiter({ limit: 1, windowMs: 60_000, prefix: "t:upstash-down" }, UPSTASH_ENV);
    // Prime the backend, then break the fake client.
    await lim.check("k");
    const instance = FakeRatelimit.instances[0] as unknown as { limit: () => Promise<never> };
    instance.limit = async () => {
      throw new Error("upstash unreachable");
    };
    // consume() must not throw — the memory fallback answers instead.
    const decision = await lim.consume("k");
    expect(decision.allowed).toBe(true);
    const second = await lim.consume("k");
    expect(second.allowed).toBe(false); // memory fallback now enforces its own count
  });
});
