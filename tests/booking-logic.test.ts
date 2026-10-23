import { describe, it, expect } from "vitest";
import { calculatePrice, calculateRefund, overlaps, isValidTransition, canJoinSession, isSessionFull, ruleForHour, isWeekend } from "@/lib/booking/logic";
import { fromWallTime } from "@/lib/time/tz";

const rules = [
  { ruleType: "OFF_PEAK", pricePerHour: 120000, startHour: 6, endHour: 17 },
  { ruleType: "PEAK", pricePerHour: 180000, startHour: 17, endHour: 22 },
  { ruleType: "WEEKEND", pricePerHour: 160000, isWeekend: true },
];
// Wall-clock dates in Asia/Ho_Chi_Minh (the business timezone), built via the
// tz helper so these tests mean the same thing under any process TZ:
// 2026-10-23 is a Friday; 2026-10-24 Saturday; 2026-10-26 Monday.
const fri = (h: number) => fromWallTime(2026, 10, 23, h, 0, 0);
const sat = (h: number) => fromWallTime(2026, 10, 24, h, 0, 0);
const mon = (h: number) => fromWallTime(2026, 10, 26, h, 0, 0);

describe("price calculation", () => {
  it("off-peak weekday hour = 120k", () => {
    expect(calculatePrice(rules, mon(10), mon(11)).total).toBe(120000);
  });
  it("peak weekday hour = 180k", () => {
    expect(calculatePrice(rules, fri(18), fri(19)).total).toBe(180000);
  });
  it("weekend wins over peak", () => {
    expect(ruleForHour(rules, sat(18)).ruleType).toBe("WEEKEND");
    expect(calculatePrice(rules, sat(18), sat(19)).total).toBe(160000);
  });
  it("multi-hour crossing peak boundary sums per hour", () => {
    // 16:00 off-peak 120k + 17:00 peak 180k = 300k
    expect(calculatePrice(rules, mon(16), mon(18)).total).toBe(300000);
  });
  it("rejects non-integer / too-long duration", () => {
    expect(() => calculatePrice(rules, mon(10), new Date(mon(10).getTime() + 30 * 60000))).toThrow("INVALID_DURATION");
    expect(() => calculatePrice(rules, mon(6), mon(14))).toThrow("INVALID_DURATION");
  });
});

describe("refund calculation", () => {
  const policy = { fullBeforeHours: 12, partialBeforeHours: 4, partialFeePercent: 30 };
  const start = fromWallTime(2026, 10, 25, 18, 0, 0); // Saigon wall clock
  it("full refund >= 12h before", () => {
    const r = calculateRefund(360000, start, fromWallTime(2026, 10, 25, 5, 0, 0), policy);
    expect(r).toEqual({ refundAmount: 360000, feePercent: 0, tier: "FULL" });
  });
  it("partial refund (30% fee) between 4h and 12h", () => {
    const r = calculateRefund(360000, start, fromWallTime(2026, 10, 25, 12, 0, 0), policy);
    expect(r.tier).toBe("PARTIAL"); expect(r.refundAmount).toBe(252000);
  });
  it("no refund under 4h", () => {
    const r = calculateRefund(360000, start, fromWallTime(2026, 10, 25, 16, 0, 0), policy);
    expect(r).toEqual({ refundAmount: 0, feePercent: 100, tier: "NONE" });
  });
});

describe("overlap detection", () => {
  const a = new Date("2026-10-25T18:00:00.000Z"), b = new Date("2026-10-25T19:00:00.000Z");
  it("overlapping ranges", () => {
    expect(overlaps(a, b, new Date("2026-10-25T18:30:00.000Z"), new Date("2026-10-25T19:30:00.000Z"))).toBe(true);
  });
  it("adjacent slots do not overlap (half-open)", () => {
    expect(overlaps(a, b, b, new Date("2026-10-25T20:00:00.000Z"))).toBe(false);
    expect(overlaps(new Date("2026-10-25T17:00:00.000Z"), a, a, b)).toBe(false);
  });
  it("disjoint ranges", () => {
    expect(overlaps(a, b, new Date("2026-10-25T20:00:00.000Z"), new Date("2026-10-25T21:00:00.000Z"))).toBe(false);
  });
});

// Regression tests for the production timezone bug: on Vercel the process TZ
// is UTC, and booking math used process-local Date getters, so a Saigon
// "Saturday 14:00" slot was stored/priced as 14:00Z (= 21:00 Saigon).
// These expectations are instant-anchored and must hold under TZ=UTC too.
describe("timezone regression (Saigon-anchored pricing)", () => {
  it("Saigon Sat 14:00 is the instant 2026-10-24T07:00:00Z and prices WEEKEND", () => {
    const start = sat(14);
    expect(start.toISOString()).toBe("2026-10-24T07:00:00.000Z");
    const end = new Date(start.getTime() + 3_600_000);
    const price = calculatePrice(rules, start, end);
    expect(price.total).toBe(160000);
    expect(price.breakdown[0].ruleType).toBe("WEEKEND");
  });
  it("Saigon Mon 18:00 is the instant 2026-10-26T11:00:00Z and prices PEAK", () => {
    const start = mon(18);
    expect(start.toISOString()).toBe("2026-10-26T11:00:00.000Z");
    const end = new Date(start.getTime() + 3_600_000);
    const price = calculatePrice(rules, start, end);
    expect(price.total).toBe(180000);
    expect(price.breakdown[0].ruleType).toBe("PEAK");
  });
  it("weekend is judged by the Saigon wall clock, not UTC", () => {
    // Fri 18:00 UTC = Sat 01:00 Saigon -> weekend in the business timezone
    expect(isWeekend(new Date("2026-10-23T18:00:00.000Z"))).toBe(true);
    // Sun 18:00 UTC = Mon 01:00 Saigon -> NOT a weekend for pricing
    expect(isWeekend(new Date("2026-10-25T18:00:00.000Z"))).toBe(false);
    // The exact instant that was mis-stored before the fix (14:00Z on Sat)
    // is 21:00 Saigon on Saturday -> still weekend, PEAK must not win
    expect(ruleForHour(rules, new Date("2026-10-24T14:00:00.000Z")).ruleType).toBe("WEEKEND");
  });
});

describe("status transitions", () => {
  it("valid transitions", () => {
    expect(isValidTransition("PENDING", "CONFIRMED")).toBe(true);
    expect(isValidTransition("PENDING", "REJECTED")).toBe(true);
    expect(isValidTransition("CONFIRMED", "CANCELLED")).toBe(true);
    expect(isValidTransition("CONFIRMED", "COMPLETED")).toBe(true);
  });
  it("invalid transitions", () => {
    expect(isValidTransition("CANCELLED", "CONFIRMED")).toBe(false);
    expect(isValidTransition("COMPLETED", "CANCELLED")).toBe(false);
    expect(isValidTransition("REJECTED", "PENDING")).toBe(false);
  });
});

describe("session capacity", () => {
  it("can join until full", () => {
    expect(canJoinSession(5, 6)).toBe(true);
    expect(canJoinSession(6, 6)).toBe(false);
    expect(isSessionFull(6, 6)).toBe(true);
    expect(isSessionFull(3, 6)).toBe(false);
  });
});
