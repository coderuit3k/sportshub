import { afterEach, describe, expect, it, vi } from "vitest";
import { fromWallTime } from "@/lib/time/tz";
import { prisma } from "@/lib/db";

/**
 * getAvailability past rule (regression): a slot used to be offered while
 * `startAt > now - 1h`, so at 18:22 the 17:30/18:00 starts looked bookable
 * and only failed at confirm, where createBooking rejects anything not in
 * the future. Now a slot is bookable only when its start is strictly in
 * the future, and non-bookable past slots are flagged `past` so the widget
 * labels them "already passed" rather than "booked".
 *
 * Prisma is mocked (facility open 06:00–22:00 every day, no bookings), and
 * Date.now is pinned to Monday 2026-10-26 18:30 Asia/Ho_Chi_Minh.
 */

vi.mock("@/lib/db", () => ({
  prisma: {
    facility: {
      findUnique: vi.fn(async () => ({
        id: "fac-1",
        venueId: "venue-1",
        priceRules: [
          { ruleType: "OFF_PEAK", pricePerHour: 120000, startHour: 6, endHour: 17 },
          { ruleType: "PEAK", pricePerHour: 180000, startHour: 17, endHour: 22 },
        ],
        venue: {
          id: "venue-1",
          status: "APPROVED",
          // 2026-10-26 is a Monday; getUTCDay() matches weekdayOfDateISO.
          hours: [{ dayOfWeek: new Date(Date.UTC(2026, 9, 26)).getUTCDay(), openTime: "06:00", closeTime: "22:00" }],
        },
      })),
    },
    booking: { findMany: vi.fn(async () => []) },
    blockedTime: { findMany: vi.fn(async () => []) },
  },
}));

import { getAvailability } from "@/services/bookings";

const DATE_ISO = "2026-10-26";
const NOW = fromWallTime(2026, 10, 26, 18, 30, 0); // 18:30 Saigon

describe("getAvailability past rule", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a slot that started 30 minutes ago is past and not available", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW.getTime());
    const avail = await getAvailability("fac-1", DATE_ISO);
    expect(avail).not.toBeNull();
    const started = avail!.slots.find((s) => s.startAt.getTime() === fromWallTime(2026, 10, 26, 18, 0, 0).getTime());
    expect(started).toBeDefined();
    expect(started!.past).toBe(true);
    expect(started!.available).toBe(false);
  });

  it("every earlier slot is past too, every later slot is future + available", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW.getTime());
    const avail = await getAvailability("fac-1", DATE_ISO);
    const slots = avail!.slots;
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      if (s.startAt.getTime() <= NOW.getTime()) {
        expect(s.past).toBe(true);
        expect(s.available).toBe(false);
      } else {
        expect(s.past).toBe(false);
        expect(s.available).toBe(true);
      }
    }
    const future = slots.find((s) => s.startAt.getTime() === fromWallTime(2026, 10, 26, 19, 0, 0).getTime());
    expect(future).toMatchObject({ past: false, available: true, price: 180000 });
  });

  it("does not publish slots for an unapproved venue", async () => {
    vi.mocked(prisma.facility.findUnique).mockResolvedValueOnce({
      id: "fac-1", venue: { status: "PENDING_APPROVAL", hours: [] }, priceRules: [],
    } as never);
    expect(await getAvailability("fac-1", DATE_ISO)).toBeNull();
  });

  it("marks a future slot with no price rules unavailable and price unknown", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW.getTime());
    vi.mocked(prisma.facility.findUnique).mockResolvedValueOnce({
      id: "fac-1", venue: { status: "APPROVED", hours: [{ dayOfWeek: 1, openTime: "19:00", closeTime: "20:00" }] }, priceRules: [],
    } as never);
    expect((await getAvailability("fac-1", DATE_ISO))?.slots[0]).toMatchObject({ price: null, available: false });
  });

  it("offers overnight slots and checks conflicts through the following morning", async () => {
    const overnight = {
      id: "fac-1", venue: { status: "APPROVED", hours: [{ dayOfWeek: 1, openTime: "05:00", closeTime: "02:00" }] },
      priceRules: [{ ruleType: "OFF_PEAK", pricePerHour: 100000 }],
    };
    vi.mocked(prisma.facility.findUnique).mockResolvedValue(overnight as never);
    vi.mocked(prisma.booking.findMany).mockResolvedValueOnce([] as never).mockResolvedValueOnce([{
      startAt: fromWallTime(2030, 1, 8, 1), endAt: fromWallTime(2030, 1, 8, 2),
    }] as never);
    const monday = await getAvailability("fac-1", "2030-01-07");
    expect(monday?.slots.at(-1)?.startAt).toEqual(fromWallTime(2030, 1, 7, 23));
    expect(monday?.slots.every((s) => s.startAt < fromWallTime(2030, 1, 8, 0))).toBe(true);
    const tuesday = await getAvailability("fac-1", "2030-01-08");
    expect(tuesday?.slots.map((s) => s.startAt)).toEqual([
      fromWallTime(2030, 1, 8, 0), fromWallTime(2030, 1, 8, 1),
    ]);
    expect(tuesday?.slots.at(-1)?.available).toBe(false);
    expect(vi.mocked(prisma.booking.findMany).mock.lastCall?.[0]).toMatchObject({
      where: { startAt: { lt: fromWallTime(2030, 1, 8, 2) } },
    });
  });
});
