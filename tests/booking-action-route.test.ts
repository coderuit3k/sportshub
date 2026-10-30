import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transition: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => ({ id: "owner-1", role: "OWNER" })) }));
vi.mock("@/lib/db", () => ({ prisma: {
  booking: { findUnique: vi.fn(async () => ({ id: "booking-1", userId: "player-1", venue: { ownerId: "owner-1" } })) },
  auditLog: { create: mocks.audit },
} }));
vi.mock("@/lib/rate-limit", () => ({
  genericWriteLimiter: { consume: vi.fn(async () => ({ allowed: true })) },
  tooManyRequests: vi.fn(),
}));
vi.mock("@/services/bookings", () => ({ transitionBooking: mocks.transition }));

import { POST } from "@/app/api/bookings/[id]/action/route";

describe("POST booking action conflict", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 409 and no audit entry when another action changed status first", async () => {
    mocks.transition.mockRejectedValueOnce(new Error("BOOKING_STATE_CHANGED"));
    const res = await POST(new Request("http://test/api/bookings/booking-1/action", {
      method: "POST", body: JSON.stringify({ action: "approve" }), headers: { "Content-Type": "application/json" },
    }), { params: Promise.resolve({ id: "booking-1" }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "BOOKING_STATE_CHANGED" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
