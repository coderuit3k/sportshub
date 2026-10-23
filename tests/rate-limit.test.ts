import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter, getClientIp } from "@/lib/rate-limit";

const T0 = 1_700_000_000_000; // fixed epoch for deterministic tests

describe("SlidingWindowLimiter", () => {
  it("allows attempts up to the limit, then denies", () => {
    const lim = new SlidingWindowLimiter(3, 60_000);
    expect(lim.consume("k", T0).allowed).toBe(true);
    expect(lim.consume("k", T0 + 1).allowed).toBe(true);
    expect(lim.consume("k", T0 + 2).allowed).toBe(true);
    const denied = lim.consume("k", T0 + 3);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it("check() peeks without recording", () => {
    const lim = new SlidingWindowLimiter(1, 60_000);
    expect(lim.check("k", T0).allowed).toBe(true);
    expect(lim.check("k", T0).allowed).toBe(true); // still allowed: nothing recorded
    lim.record("k", T0);
    expect(lim.check("k", T0).allowed).toBe(false);
  });

  it("reports a positive Retry-After based on the oldest hit", () => {
    const lim = new SlidingWindowLimiter(1, 60_000);
    lim.record("k", T0);
    const d = lim.check("k", T0 + 10_000);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterSeconds).toBe(50); // (60s window − 10s elapsed)
  });

  it("slides: old hits expire out of the window", () => {
    const lim = new SlidingWindowLimiter(2, 60_000);
    lim.record("k", T0);
    lim.record("k", T0 + 30_000);
    expect(lim.check("k", T0 + 59_999).allowed).toBe(false);
    // First hit (T0) has slid out at T0+60_001 → one slot free again.
    expect(lim.check("k", T0 + 60_001).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const lim = new SlidingWindowLimiter(1, 60_000);
    lim.record("a", T0);
    expect(lim.check("a", T0).allowed).toBe(false);
    expect(lim.check("b", T0).allowed).toBe(true);
  });

  it("reset() clears a key (e.g. after successful login)", () => {
    const lim = new SlidingWindowLimiter(1, 60_000);
    lim.record("k", T0);
    expect(lim.check("k", T0).allowed).toBe(false);
    lim.reset("k");
    expect(lim.check("k", T0).allowed).toBe(true);
  });

  it("remaining counts down on consume", () => {
    const lim = new SlidingWindowLimiter(3, 60_000);
    expect(lim.consume("k", T0).remaining).toBe(2);
    expect(lim.consume("k", T0).remaining).toBe(1);
    expect(lim.consume("k", T0).remaining).toBe(0);
  });
});

describe("getClientIp", () => {
  const reqWith = (headers: Record<string, string>) =>
    new Request("http://localhost/api/auth/login", { headers });

  it("takes the first x-forwarded-for hop", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then 'unknown'", () => {
    expect(getClientIp(reqWith({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(getClientIp(reqWith({}))).toBe("unknown");
  });
});
