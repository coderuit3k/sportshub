import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSession: vi.fn(), createParticipant: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => ({ id: "organizer", name: "Organizer" })) }));
vi.mock("@/lib/rate-limit", () => ({
  sessionCreateLimiter: { consume: vi.fn(async () => ({ allowed: true })) }, tooManyRequests: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  sportsSession: { create: mocks.createSession }, sessionParticipant: { create: mocks.createParticipant },
} }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidate }));
vi.mock("@/lib/public-data", () => ({ SESSIONS_TAG: "sessions" }));

import { POST } from "@/app/api/sessions/route";

const request = () => new Request("http://test/api/sessions", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "Kèo cuối tuần", sportId: "sport-1", startAt: "2030-01-07T10:00:00.000Z",
    endAt: "2030-01-07T11:00:00.000Z", maxParticipants: 2 }),
});

describe("POST /api/sessions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createSession.mockResolvedValue({ id: "session-1" });
    mocks.createParticipant.mockResolvedValue({ id: "participant-1" });
  });

  it("creates the organizer with the session in one nested write", async () => {
    expect((await POST(request())).status).toBe(201);
    expect(mocks.createSession.mock.calls[0][0]).toMatchObject({
      data: { participants: { create: { userId: "organizer", status: "JOINED" } } },
    });
    expect(mocks.createParticipant).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith("sessions");
  });

  it("does not invalidate the cache when the atomic create fails", async () => {
    mocks.createSession.mockRejectedValueOnce(new Error("organizer insert failed"));
    await expect(POST(request())).rejects.toThrow("organizer insert failed");
    expect(mocks.createParticipant).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
