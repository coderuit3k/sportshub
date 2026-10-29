import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { changeSessionParticipation } from "@/services/sessions";

const repoRoot = path.resolve(__dirname, "..");
const tempDir = mkdtempSync(path.join(tmpdir(), "sportshub-session-join-"));
const dbUrl = `file:${path.join(tempDir, "test.db")}`;
let first: PrismaClient;
let second: PrismaClient;

beforeAll(async () => {
  const engineDir = path.join(repoRoot, "node_modules", "@prisma", "engines");
  const engine = readdirSync(engineDir).find((name) => name.startsWith("schema-engine-") && !name.endsWith(".md"));
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", {
    cwd: repoRoot,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: dbUrl, CHECKPOINT_DISABLE: "1",
      ...(engine && existsSync(path.join(engineDir, engine)) ? { PRISMA_SCHEMA_ENGINE_BINARY: path.join(engineDir, engine) } : {}) },
  });
  first = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  second = new PrismaClient({ datasources: { db: { url: dbUrl } } });
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
  await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("session join on SQLite", () => {
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
