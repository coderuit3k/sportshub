import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromWallTime } from "@/lib/time/tz";

const mocks = vi.hoisted(() => ({
  status: "PENDING",
  findBooking: vi.fn(),
  updateBooking: vi.fn(),
  createHistory: vi.fn(),
  createPayment: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {
  booking: { findUnique: mocks.findBooking },
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({
    booking: { update: mocks.updateBooking },
    bookingStatusHistory: { create: mocks.createHistory },
    payment: { create: mocks.createPayment },
  }),
} }));
vi.mock("@/lib/notifications", () => ({ notify: mocks.notify }));

import { transitionBooking } from "@/services/bookings";

const initial = {
  id: "booking-1", userId: "player-1", reference: "SH-TEST", totalPrice: 100000,
  startAt: fromWallTime(2030, 1, 7, 10),
  policySnapshot: JSON.stringify({ fullBeforeHours: 12, partialBeforeHours: 4, partialFeePercent: 30 }),
};

describe("transitionBooking concurrency", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.status = "PENDING";
    mocks.findBooking.mockImplementation(async () => ({ ...initial, status: mocks.status }));
    mocks.updateBooking.mockImplementation(async ({ where, data }) => {
      if (where.status && where.status !== mocks.status) {
        throw Object.assign(new Error("Record not found"), { code: "P2025" });
      }
      mocks.status = data.status;
      return { ...initial, status: mocks.status, refundAmount: data.refundAmount };
    });
    mocks.notify.mockResolvedValue(undefined);
  });

  it("only one of two competing owner decisions changes status and writes history", async () => {
    const outcomes = await Promise.allSettled([
      transitionBooking(initial.id, "CONFIRMED", "owner-1"),
      transitionBooking(initial.id, "REJECTED", "owner-1"),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
    expect((outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult).reason.message).toBe("BOOKING_STATE_CHANGED");
    expect(mocks.createHistory).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.updateBooking.mock.calls.every(([arg]) => arg.where.status === "PENDING")).toBe(true);
  });

  it("a double cancellation creates only one simulated refund", async () => {
    mocks.status = "CONFIRMED";
    const outcomes = await Promise.allSettled([
      transitionBooking(initial.id, "CANCELLED", "player-1"),
      transitionBooking(initial.id, "CANCELLED", "player-1"),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
    expect((outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult).reason.message).toBe("BOOKING_STATE_CHANGED");
    expect(mocks.createHistory).toHaveBeenCalledTimes(1);
    expect(mocks.createPayment).toHaveBeenCalledTimes(1);
    expect(mocks.createPayment.mock.calls[0][0].data.amount).toBe(-100000);
  });
});
