import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb } from "./db";
import { createPrismaClient } from "../src/lib/prisma-client";

let first: Awaited<ReturnType<typeof createTestDb>>;
let second: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  first = await createTestDb();
  second = await createTestDb();
}, 180_000);
afterAll(async () => {
  await first?.cleanup();
  await second?.cleanup();
});

it("keeps model and raw queries isolated across schemas with identical IDs", async () => {
  for (const [fixture, name] of [[first, "first"], [second, "second"]] as const) {
    await fixture.db.user.create({ data: { id: "same-id", email: "same@test.local", name, passwordHash: "x" } });
  }
  expect((await first.db.user.findUniqueOrThrow({ where: { id: "same-id" } })).name).toBe("first");
  expect(await first.db.$queryRaw`SELECT name FROM "User"`).toEqual([{ name: "first" }]);
  expect(await second.db.$queryRaw`SELECT name FROM "User"`).toEqual([{ name: "second" }]);
});

it("does not let URL options redirect raw queries out of the selected schema", async () => {
  const url = new URL(first.url);
  url.searchParams.set("options", "-c search_path=public");
  const db = createPrismaClient(url.toString());
  try {
    expect(await db.$queryRaw`SELECT current_schema() AS schema`).toEqual([{ schema: url.searchParams.get("schema") }]);
  } finally { await db.$disconnect(); }
});
