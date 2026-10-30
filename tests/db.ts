import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { ensureBookingConstraint } from "../prisma/booking-constraint";

export function testDatabaseUrl(value = process.env.TEST_DATABASE_URL): URL {
  if (!value) throw new Error("TEST_DATABASE_URL is required for PostgreSQL tests");
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL"); }
  if (!["postgresql:", "postgres:"].includes(url.protocol) || !/^\/[a-zA-Z0-9_]+_test$/.test(url.pathname)) {
    throw new Error("Tests require a PostgreSQL database whose name ends in _test");
  }
  return url;
}

/** Only generated schemas in an explicitly selected test database are disposable. */
export async function createTestDb(value?: string) {
  const url = testDatabaseUrl(value);
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  url.searchParams.set("schema", schema);
  const connection = url.toString();
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: connection }, stdio: "pipe",
  });
  const db = new PrismaClient({ datasources: { db: { url: connection } } });
  const cleanup = async () => {
    try {
      // schema is generated above, never derived from user/database input.
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally { await db.$disconnect(); }
  };
  try { await ensureBookingConstraint(db); }
  catch (error) {
    try { await cleanup(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Test setup and cleanup failed"); }
    throw error;
  }
  return { db, url: connection, cleanup };
}
