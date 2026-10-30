import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  users: [] as { id: string; name: string }[],
  joined: new Map<string, string>(),
  session: { id: "session-1", organizerId: "organizer", title: "Kèo cuối tuần", maxParticipants: 2, status: "OPEN" },
}));
const mocks = vi.hoisted(() => ({ notify: vi.fn(), revalidate: vi.fn(), transaction: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => state.users.shift() ?? null) }));
vi.mock("@/lib/rate-limit", () => ({
  sessionJoinLimiter: { consume: vi.fn(async () => ({ allowed: true })) }, tooManyRequests: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({ notify: mocks.notify }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidate }));
vi.mock("@/lib/public-data", () => ({ SESSIONS_TAG: "sessions" }));

const db = vi.hoisted(() => ({
  sportsSession: {
    findUnique: vi.fn(async () => ({ ...state.session, participants: [...state.joined].map(([userId, status]) => ({ userId, status })) })),
    update: vi.fn(async ({ data }: { data: { status: string } }) => { state.session.status = data.status; return state.session; }),
  },
  sessionParticipant: {
    findUnique: vi.fn(async ({ where }: { where: { sessionId_userId: { userId: string } } }) => {
      const status = state.joined.get(where.sessionId_userId.userId);
      return status ? { userId: where.sessionId_userId.userId, status } : null;
    }),
    count: vi.fn(async () => [...state.joined.values()].filter((status) => status === "JOINED").length),
    upsert: vi.fn(async ({ create }: { create: { userId: string } }) => { state.joined.set(create.userId, "JOINED"); }),
    deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => { state.joined.delete(where.userId); }),
  },
}));
vi.mock("@/lib/db", () => ({ prisma: { ...db, $transaction: mocks.transaction } }));

import { POST } from "@/app/api/sessions/[id]/join/route";

function action(userId: string, type: "join" | "leave") {
  state.users.push({ id: userId, name: userId });
  return POST(new Request("http://test/api/sessions/session-1/join", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: type }),
  }), { params: Promise.resolve({ id: "session-1" }) });
}

describe("session join capacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.joined = new Map([["organizer", "JOINED"]]);
    state.session = { id: "session-1", organizerId: "organizer", title: "Kèo cuối tuần", maxParticipants: 2, status: "OPEN" };
    state.users = [];
    let pending = Promise.resolve();
    mocks.transaction.mockImplementation((fn: (tx: typeof db) => Promise<unknown>) => {
      const result = pending.then(() => fn(db));
      pending = result.then(() => undefined, () => undefined);
      return result;
    });
    mocks.notify.mockResolvedValue(undefined);
  });

  it("admits only one of two users competing for the last place", async () => {
    const [first, second] = await Promise.all([action("player-a", "join"), action("player-b", "join")]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect([...state.joined.values()].filter((status) => status === "JOINED")).toHaveLength(2);
    expect(state.session.status).toBe("FULL");
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls.every(([, options]) => options?.isolationLevel === "Serializable")).toBe(true);
  });

  it("rejects a duplicate join without adding another participant", async () => {
    state.joined.set("player-a", "JOINED");
    expect((await action("player-a", "join")).status).toBe(409);
    expect(state.joined.size).toBe(2);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("reopens a full session when a participant leaves", async () => {
    state.joined.set("player-a", "JOINED");
    state.session.status = "FULL";
    expect((await action("player-a", "leave")).status).toBe(200);
    expect(state.session.status).toBe("OPEN");
    expect(state.joined.size).toBe(1);
    expect(mocks.revalidate).toHaveBeenCalledWith("sessions");
  });

  it("does not join a cancelled session", async () => {
    state.session.status = "CANCELLED";
    expect((await action("player-a", "join")).status).toBe(409);
    expect(state.joined.size).toBe(1);
  });

  it("retries a serializable write conflict before admitting a join", async () => {
    const run = mocks.transaction.getMockImplementation()!;
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error("write conflict"), { code: "P2034" })).mockImplementation(run);
    expect((await action("player-a", "join")).status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("returns a safe error when the database fails unexpectedly", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("private database detail"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await action("player-a", "join");
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Không cập nhật được kèo" });
      expect(mocks.revalidate).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
