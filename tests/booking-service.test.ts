import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromWallTime } from "@/lib/time/tz";

const mocks = vi.hoisted(() => ({
  findBooking: vi.fn(),
  findFacility: vi.fn(),
  findConflicts: vi.fn(),
  findBlocked: vi.fn(),
  createBookingRow: vi.fn(),
  createHistory: vi.fn(),
  createIdempotency: vi.fn(),
  createPayment: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  booking: { findUnique: mocks.findBooking, findMany: mocks.findConflicts, create: mocks.createBookingRow },
  facility: { findUnique: mocks.findFacility },
  blockedTime: { findMany: mocks.findBlocked },
  bookingStatusHistory: { create: mocks.createHistory },
  idempotencyKey: { create: mocks.createIdempotency },
  payment: { create: mocks.createPayment },
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({
    booking: { findUnique: mocks.findBooking, findMany: mocks.findConflicts, create: mocks.createBookingRow },
    blockedTime: { findMany: mocks.findBlocked },
    bookingStatusHistory: { create: mocks.createHistory },
    idempotencyKey: { create: mocks.createIdempotency },
    payment: { create: mocks.createPayment },
  }),
} }));
vi.mock("@/lib/notifications", () => ({ notify: mocks.notify }));

import { createBooking } from "@/services/bookings";

const startAt = fromWallTime(2030, 1, 7, 10);
const endAt = fromWallTime(2030, 1, 7, 11);
const input = { userId: "player-1", facilityId: "fac-1", startAt, endAt, idempotencyKey: "booking-key-1" };
const venue = { id: "venue-1", status: "APPROVED", ownerId: "owner-1", instantBooking: true,
  cancelFullBeforeHours: 12, cancelPartialBeforeHours: 4, cancelPartialFeePercent: 30,
  hours: [{ dayOfWeek: 1, openTime: "09:00", closeTime: "22:00" }] };
const facility = { id: "fac-1", venueId: "venue-1", venue,
  priceRules: [{ ruleType: "OFF_PEAK", pricePerHour: 100000 }] };
const row = { id: "booking-1", reference: "SH-20300107-1234", ...input, status: "CONFIRMED", totalPrice: 100000 };

describe("createBooking request integrity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findBooking.mockResolvedValue(null);
    mocks.findFacility.mockResolvedValue(facility);
    mocks.findConflicts.mockResolvedValue([]);
    mocks.findBlocked.mockResolvedValue([]);
    mocks.createBookingRow.mockResolvedValue(row);
    mocks.notify.mockResolvedValue(undefined);
  });

  it("returns the same booking for the same user's exact retry", async () => {
    mocks.findBooking.mockResolvedValueOnce(row);
    expect(await createBooking(input)).toEqual({ booking: row, created: false });
    expect(mocks.createBookingRow).not.toHaveBeenCalled();
  });

  it("rejects a key belonging to another user without revealing their booking", async () => {
    mocks.findBooking.mockResolvedValueOnce(row);
    await expect(createBooking({ ...input, userId: "player-2" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("rejects the same key with a changed booking request", async () => {
    mocks.findBooking.mockResolvedValueOnce(row);
    await expect(createBooking({ ...input, endAt: fromWallTime(2030, 1, 7, 12) })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("returns created=false for a duplicate found inside the transaction", async () => {
    mocks.findBooking.mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    expect(await createBooking(input)).toEqual({ booking: row, created: false });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("rejects a cross-user duplicate found inside the transaction", async () => {
    mocks.findBooking.mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    await expect(createBooking({ ...input, userId: "player-2" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("returns the existing booking after a concurrent insert wins the unique key", async () => {
    mocks.createBookingRow.mockRejectedValueOnce(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    mocks.findBooking.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    expect(await createBooking(input)).toEqual({ booking: row, created: false });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("does not reveal another user's booking after a unique-key race", async () => {
    mocks.createBookingRow.mockRejectedValueOnce(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    mocks.findBooking.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    await expect(createBooking({ ...input, userId: "player-2" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("rejects a start before opening and an end after closing", async () => {
    await expect(createBooking({ ...input, startAt: fromWallTime(2030, 1, 7, 8), endAt: fromWallTime(2030, 1, 7, 9) }))
      .rejects.toThrow("OUTSIDE_OPENING_HOURS");
    await expect(createBooking({ ...input, startAt: fromWallTime(2030, 1, 7, 22), endAt: fromWallTime(2030, 1, 7, 23) }))
      .rejects.toThrow("OUTSIDE_OPENING_HOURS");
    await expect(createBooking({ ...input, startAt: fromWallTime(2030, 1, 7, 21, 0, 30), endAt: fromWallTime(2030, 1, 7, 22, 0, 30) }))
      .rejects.toThrow("OUTSIDE_OPENING_HOURS");
    expect(mocks.createBookingRow).not.toHaveBeenCalled();
  });

  it("creates a booking ending exactly at closing time", async () => {
    expect((await createBooking({ ...input, startAt: fromWallTime(2030, 1, 7, 21), endAt: fromWallTime(2030, 1, 7, 22) })).created).toBe(true);
  });

  it("allows a venue closing at midnight through its Monday closing instant", async () => {
    mocks.findFacility.mockResolvedValue({ ...facility, venue: { ...venue, hours: [{ dayOfWeek: 1, openTime: "05:00", closeTime: "00:00" }] } });
    expect((await createBooking({ ...input, startAt: fromWallTime(2030, 1, 7, 10), endAt: fromWallTime(2030, 1, 7, 11) })).created).toBe(true);
    expect((await createBooking({ ...input, startAt: fromWallTime(2030, 1, 7, 23), endAt: fromWallTime(2030, 1, 8, 0) })).created).toBe(true);
  });

  it("allows the previous day's late shift after midnight, then closes at 02:00", async () => {
    mocks.findFacility.mockResolvedValue({ ...facility, venue: { ...venue, hours: [{ dayOfWeek: 1, openTime: "05:00", closeTime: "02:00" }] } });
    expect((await createBooking({ ...input, startAt: fromWallTime(2030, 1, 8, 0), endAt: fromWallTime(2030, 1, 8, 1) })).created).toBe(true);
    await expect(createBooking({ ...input, startAt: fromWallTime(2030, 1, 8, 2), endAt: fromWallTime(2030, 1, 8, 3) })).rejects.toThrow("OUTSIDE_OPENING_HOURS");
  });
});
