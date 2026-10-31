import { createPrismaClient } from "../src/lib/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client";
import { createTestDb } from "./db";
import { changeSessionParticipation } from "@/services/sessions";

let fixture: Awaited<ReturnType<typeof createTestDb>>;
let first: PrismaClient;
let second: PrismaClient;

beforeAll(async () => {
  fixture = await createTestDb();
  first = fixture.db;
  second = createPrismaClient(fixture.url);
  await first.sport.create({ data: { id: "sport-1", name: "Cầu lông", slug: "cau-long" } });
  await first.user.createMany({ data: [
    { id: "organizer", name: "Organizer", email: "organizer@test.local", passwordHash: "x" },
    { id: "player-a", name: "Player A", email: "player-a@test.local", passwordHash: "x" },
    { id: "player-b", name: "Player B", email: "player-b@test.local", passwordHash: "x" },
  ] });
  await first.sportsSession.create({ data: {
    id: "session-1", title: "Last spot", sportId: "sport-1", organizerId: "organizer",
    startAt: new Date("2030-01-07T10:00:00Z"), endAt: new Date("2030-01-07T11:00:00Z"), maxParticipants: 2,
  } });
  await first.sessionParticipant.create({ data: { sessionId: "session-1", userId: "organizer", status: "JOINED" } });
}, 180_000);

afterAll(async () => {
  await second?.$disconnect();
  await fixture?.cleanup();
});

describe("session join on PostgreSQL", () => {
  it("never stores more than the capacity when two clients join the last spot", async () => {
    const results = await Promise.allSettled([
      changeSessionParticipation("session-1", "player-a", "join", first),
      changeSessionParticipation("session-1", "player-b", "join", second),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await first.sessionParticipant.count({ where: { sessionId: "session-1", status: "JOINED" } })).toBe(2);
    expect((await first.sportsSession.findUniqueOrThrow({ where: { id: "session-1" } })).status).toBe("FULL");
  });

  it("rolls back a nested session create when organizer participation fails", async () => {
    await expect(first.sportsSession.create({ data: {
      id: "failed-session", title: "Should roll back", sportId: "sport-1", organizerId: "organizer",
      startAt: new Date("2030-01-08T10:00:00Z"), endAt: new Date("2030-01-08T11:00:00Z"), maxParticipants: 2,
      participants: { create: { userId: "missing-user", status: "JOINED" } },
    } })).rejects.toThrow();
    expect(await first.sportsSession.findUnique({ where: { id: "failed-session" } })).toBeNull();
  });
});
