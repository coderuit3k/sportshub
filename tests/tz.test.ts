import { describe, it, expect } from "vitest";
import {
  wallClockParts, fromWallTime, parseDateISO, isValidDateISO, toDateISO,
  weekdayOfDateISO, startOfDay, endOfDay, formatTimeHHMM, saigonDateTimeToInstant, BUSINESS_TZ,
} from "@/lib/time/tz";

// These tests must pass under ANY process timezone (the suite is run with
// TZ=UTC and TZ=Asia/Ho_Chi_Minh): every expectation below is anchored to
// Asia/Ho_Chi_Minh wall clock, which is the whole point of the helper.

describe("business timezone helpers", () => {
  it("uses Asia/Ho_Chi_Minh", () => {
    expect(BUSINESS_TZ).toBe("Asia/Ho_Chi_Minh");
  });

  it("builds the UTC instant for a Saigon wall-clock time", () => {
    // Sat 2026-10-24 14:00 in Saigon = 07:00Z (UTC+7, no DST)
    expect(fromWallTime(2026, 10, 24, 14, 0).toISOString()).toBe("2026-10-24T07:00:00.000Z");
    // Midnight Saigon = 17:00Z the previous UTC day
    expect(fromWallTime(2026, 10, 24, 0, 0).toISOString()).toBe("2026-10-23T17:00:00.000Z");
  });

  it("reads wall-clock parts in Saigon, not in process TZ", () => {
    const p = wallClockParts(new Date("2026-10-24T07:00:00.000Z"));
    expect(p).toMatchObject({ year: 2026, month: 10, day: 24, hour: 14, minute: 0, weekday: 6 }); // Saturday
    // 17:30Z is already 00:30 the NEXT day (Saturday) in Saigon
    const q = wallClockParts(new Date("2026-10-23T17:30:00.000Z"));
    expect(q).toMatchObject({ year: 2026, month: 10, day: 24, hour: 0, minute: 30, weekday: 6 });
  });

  it("round-trips wall time -> instant -> wall time", () => {
    const inst = fromWallTime(2026, 1, 5, 6, 30, 15);
    expect(wallClockParts(inst)).toMatchObject({ year: 2026, month: 1, day: 5, hour: 6, minute: 30, second: 15, weekday: 1 }); // Monday
  });

  it("computes Saigon calendar-day boundaries", () => {
    expect(startOfDay("2026-10-24").toISOString()).toBe("2026-10-23T17:00:00.000Z");
    expect(endOfDay("2026-10-24").toISOString()).toBe("2026-10-24T17:00:00.000Z");
    // Year rollover
    expect(endOfDay("2026-12-31").toISOString()).toBe("2026-12-31T17:00:00.000Z");
    expect(startOfDay("2027-01-01").toISOString()).toBe("2026-12-31T17:00:00.000Z");
  });

  it("weekday of a calendar date (0=Sunday)", () => {
    expect(weekdayOfDateISO("2026-10-24")).toBe(6); // Saturday
    expect(weekdayOfDateISO("2026-10-25")).toBe(0); // Sunday
    expect(weekdayOfDateISO("2026-10-26")).toBe(1); // Monday
  });

  it("maps an instant to its Saigon calendar date", () => {
    expect(toDateISO(new Date("2026-10-23T16:59:59.000Z"))).toBe("2026-10-23"); // 23:59:59 Saigon
    expect(toDateISO(new Date("2026-10-23T17:00:00.000Z"))).toBe("2026-10-24"); // 00:00 Saigon next day
  });

  it("formats Saigon HH:MM labels", () => {
    expect(formatTimeHHMM(new Date("2026-10-24T07:00:00.000Z"))).toBe("14:00");
    expect(formatTimeHHMM(new Date("2026-10-23T17:05:00.000Z"))).toBe("00:05");
  });

  it("parses date+time strings as Saigon wall clock", () => {
    expect(saigonDateTimeToInstant("2026-10-24", "14:00").toISOString()).toBe("2026-10-24T07:00:00.000Z");
    expect(saigonDateTimeToInstant("2026-10-24", "18:30").toISOString()).toBe("2026-10-24T11:30:00.000Z");
  });

  it("validates calendar dates", () => {
    expect(isValidDateISO("2026-10-24")).toBe(true);
    expect(isValidDateISO("2026-02-29")).toBe(false); // 2026 is not a leap year
    expect(isValidDateISO("24/10/2026")).toBe(false);
    expect(() => parseDateISO("2026-13-01")).toThrow("INVALID_DATE");
  });
});
