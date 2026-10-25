// Pure booking logic — no DB imports, unit-testable.
// All wall-clock readings (weekday, hour) are taken in the business timezone
// Asia/Ho_Chi_Minh via @/lib/time/tz — never from process-local Date getters,
// so pricing is identical on a UTC server (Vercel) and a Saigon dev machine.
import { wallClockParts } from "@/lib/time/tz";

export interface PriceRuleLike {
  ruleType: string; // OFF_PEAK | PEAK | WEEKEND
  pricePerHour: number;
  startHour?: number | null;
  endHour?: number | null;
  isWeekend?: boolean | null;
}
export interface CancellationPolicy {
  fullBeforeHours: number;
  partialBeforeHours: number;
  partialFeePercent: number;
}

export function isWeekend(date: Date): boolean {
  const d = wallClockParts(date).weekday;
  return d === 0 || d === 6;
}

/** Pick the rule for a single hour starting at `hourStart`. Weekend wins, then PEAK (by hour range), else OFF_PEAK. */
export function ruleForHour(rules: PriceRuleLike[], hourStart: Date): PriceRuleLike {
  if (isWeekend(hourStart)) {
    const w = rules.find((r) => r.ruleType === "WEEKEND");
    if (w) return w;
  }
  const h = wallClockParts(hourStart).hour;
  const peak = rules.find(
    (r) => r.ruleType === "PEAK" && (r.startHour == null || h >= r.startHour) && (r.endHour == null || h < r.endHour)
  );
  if (peak) return peak;
  const off = rules.find((r) => r.ruleType === "OFF_PEAK");
  if (off) return off;
  // Fallback: cheapest rule so we never return undefined
  return [...rules].sort((a, b) => a.pricePerHour - b.pricePerHour)[0];
}

export interface PriceBreakdownItem { hourStart: string; ruleType: string; pricePerHour: number }
export interface PriceResult { total: number; breakdown: PriceBreakdownItem[] }

/** Server-side price: walk hour-by-hour from start to end. Duration must be whole hours, 1..6. */
export function calculatePrice(rules: PriceRuleLike[], startAt: Date, endAt: Date): PriceResult {
  if (rules.length === 0) throw new Error("NO_PRICE_RULES");
  const ms = endAt.getTime() - startAt.getTime();
  const hours = ms / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0 || !Number.isInteger(hours) || hours > 6) {
    throw new Error("INVALID_DURATION");
  }
  const breakdown: PriceBreakdownItem[] = [];
  let total = 0;
  for (let i = 0; i < hours; i++) {
    const slot = new Date(startAt.getTime() + i * 3_600_000);
    const rule = ruleForHour(rules, slot);
    breakdown.push({ hourStart: slot.toISOString(), ruleType: rule.ruleType, pricePerHour: rule.pricePerHour });
    total += rule.pricePerHour;
  }
  return { total, breakdown };
}

export function hoursBefore(startAt: Date, now: Date): number {
  return (startAt.getTime() - now.getTime()) / 3_600_000;
}

export interface RefundResult { refundAmount: number; feePercent: number; tier: "FULL" | "PARTIAL" | "NONE" }
export function calculateRefund(totalPrice: number, startAt: Date, now: Date, policy: CancellationPolicy): RefundResult {
  const h = hoursBefore(startAt, now);
  if (h >= policy.fullBeforeHours) return { refundAmount: totalPrice, feePercent: 0, tier: "FULL" };
  if (h >= policy.partialBeforeHours) {
    const fee = Math.round((totalPrice * policy.partialFeePercent) / 100);
    return { refundAmount: totalPrice - fee, feePercent: policy.partialFeePercent, tier: "PARTIAL" };
  }
  return { refundAmount: 0, feePercent: 100, tier: "NONE" };
}

/** Half-open interval overlap: [aStart,aEnd) vs [bStart,bEnd). Adjacent slots do NOT overlap. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["CANCELLED", "COMPLETED", "EXPIRED"],
  REJECTED: [],
  CANCELLED: [],
  COMPLETED: [],
  EXPIRED: [],
};
export function isValidTransition(from: string, to: string): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export const ACTIVE_BOOKING_STATUSES = ["PENDING", "CONFIRMED"];

export function canJoinSession(currentJoined: number, maxParticipants: number): boolean {
  return currentJoined < maxParticipants;
}
export function isSessionFull(currentJoined: number, maxParticipants: number): boolean {
  return currentJoined >= maxParticipants;
}

export function formatVND(amount: number, locale = "vi-VN"): string {
  // Locale-aware price rendering: vi keeps the historical "160.000 đ"
  // format (unit tests + owner/admin pages rely on the default), en uses
  // "160,000 VND".
  if (locale.startsWith("en")) return `${new Intl.NumberFormat("en-US").format(amount)} VND`;
  return new Intl.NumberFormat("vi-VN").format(amount) + " đ";
}
export function makeReference(now = new Date()): string {
  const p = wallClockParts(now); // reference date = Saigon calendar date
  const ymd = `${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `SH-${ymd}-${rand}`;
}
