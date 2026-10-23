import { describe, it, expect } from "vitest";
import { calculatePrice, calculateRefund, overlaps, isValidTransition, canJoinSession, isSessionFull, ruleForHour } from "@/lib/booking/logic";

const rules = [
  { ruleType: "OFF_PEAK", pricePerHour: 120000, startHour: 6, endHour: 17 },
  { ruleType: "PEAK", pricePerHour: 180000, startHour: 17, endHour: 22 },
  { ruleType: "WEEKEND", pricePerHour: 160000, isWeekend: true },
];
// 2026-10-23 is a Friday; 2026-10-24 Saturday; 2026-10-26 Monday
const fri = (h: number) => new Date(2026, 9, 23, h, 0, 0);
const sat = (h: number) => new Date(2026, 9, 24, h, 0, 0);
const mon = (h: number) => new Date(2026, 9, 26, h, 0, 0);

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
  const start = new Date("2026-10-25T18:00:00");
  it("full refund >= 12h before", () => {
    const r = calculateRefund(360000, start, new Date("2026-10-25T05:00:00"), policy);
    expect(r).toEqual({ refundAmount: 360000, feePercent: 0, tier: "FULL" });
  });
  it("partial refund (30% fee) between 4h and 12h", () => {
    const r = calculateRefund(360000, start, new Date("2026-10-25T12:00:00"), policy);
    expect(r.tier).toBe("PARTIAL"); expect(r.refundAmount).toBe(252000);
  });
  it("no refund under 4h", () => {
    const r = calculateRefund(360000, start, new Date("2026-10-25T16:00:00"), policy);
    expect(r).toEqual({ refundAmount: 0, feePercent: 100, tier: "NONE" });
  });
});

describe("overlap detection", () => {
  const a = new Date("2026-10-25T18:00:00"), b = new Date("2026-10-25T19:00:00");
  it("overlapping ranges", () => {
    expect(overlaps(a, b, new Date("2026-10-25T18:30:00"), new Date("2026-10-25T19:30:00"))).toBe(true);
  });
  it("adjacent slots do not overlap (half-open)", () => {
    expect(overlaps(a, b, b, new Date("2026-10-25T20:00:00"))).toBe(false);
    expect(overlaps(new Date("2026-10-25T17:00:00"), a, a, b)).toBe(false);
  });
  it("disjoint ranges", () => {
    expect(overlaps(a, b, new Date("2026-10-25T20:00:00"), new Date("2026-10-25T21:00:00"))).toBe(false);
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
