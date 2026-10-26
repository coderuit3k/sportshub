import { describe, expect, it } from "vitest";
import {
  apiGlobalLimiter,
  genericWriteLimiter,
  passwordChangeLimiter,
  reviewCreateLimiter,
  sessionCreateLimiter,
  sessionJoinLimiter,
  type SharedRateLimiter,
} from "@/lib/rate-limit";

/**
 * Quota tests for the buckets added in the rate-limit extension round
 * (global API net + per-user write buckets). These drive the REAL module
 * singletons the handlers/middleware use — not parallel constructions —
 * so a quota edit in src/lib/rate-limit.ts that is not reflected here
 * fails loudly.
 *
 * The singletons resolve their backend from the environment at first
 * use; the suite assumes the test environment has NO KV_REST_API_* pair
 * (true for local dev and CI today), i.e. the in-memory backend. That
 * assumption is asserted explicitly below rather than left silent: if a
 * KV pair ever leaks into the test env, these tests fail with a clear
 * cause instead of hitting a real Redis.
 *
 * Keys are unique per test so the module-level singletons' counters
 * never leak between tests.
 */

let seq = 0;
const freshKey = (tag: string) => `${tag}:test-${++seq}-${Date.now()}`;

async function expectQuota(limiter: SharedRateLimiter, limit: number, windowSeconds: number, tag: string) {
  expect(limiter.backendKind).toBe("memory");
  const key = freshKey(tag);
  for (let i = 0; i < limit; i++) {
    const d = await limiter.consume(key);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(limit - i - 1);
  }
  const denied = await limiter.consume(key);
  expect(denied.allowed).toBe(false);
  expect(denied.remaining).toBe(0);
  expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  expect(denied.retryAfterSeconds).toBeLessThanOrEqual(windowSeconds);
  // A different subject is unaffected by the exhausted key.
  const other = await limiter.consume(freshKey(tag));
  expect(other.allowed).toBe(true);
}

describe("apiGlobalLimiter (middleware safety net)", () => {
  it("allows 600 requests per 10 minutes per key, then denies", async () => {
    await expectQuota(apiGlobalLimiter, 600, 600, "api");
  });
});

describe("sessionCreateLimiter", () => {
  it("allows 10 creations per hour per user, then denies", async () => {
    await expectQuota(sessionCreateLimiter, 10, 3600, "session-create");
  });
});

describe("sessionJoinLimiter", () => {
  it("allows 30 join/leave attempts per 10 minutes per user, then denies", async () => {
    await expectQuota(sessionJoinLimiter, 30, 600, "session-join");
  });
});

describe("reviewCreateLimiter (reserved — no review endpoint exists yet)", () => {
  it("is defined with a quota of 10 per hour per user", async () => {
    await expectQuota(reviewCreateLimiter, 10, 3600, "review-create");
  });
});

describe("passwordChangeLimiter", () => {
  it("allows 5 attempts per hour per user, then denies", async () => {
    await expectQuota(passwordChangeLimiter, 5, 3600, "password-change");
  });
});

describe("genericWriteLimiter", () => {
  it("allows 60 writes per 10 minutes per user, then denies", async () => {
    await expectQuota(genericWriteLimiter, 60, 600, "write");
  });

  it("shares one bucket across routes: keys are the subject, not the route", async () => {
    // The favorites/profile/admin routes all consume with `write:{userId}`,
    // so writes on different routes drain the SAME quota by design.
    const key = freshKey("write-shared");
    for (let i = 0; i < 60; i++) await genericWriteLimiter.consume(key);
    expect((await genericWriteLimiter.consume(key)).allowed).toBe(false);
  });
});
