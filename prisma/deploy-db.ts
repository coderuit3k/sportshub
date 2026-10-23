/**
 * Production database bootstrap — runs inside the Vercel build (see vercel.json),
 * after `prisma db push` against the PostgreSQL schema.
 *
 * 1. Ensures the booking_no_overlap_active exclusion constraint exists
 *    (same SQL as prisma/postgresql/booking_no_overlap.sql — tsrange variant,
 *    because Prisma maps DateTime to TIMESTAMP(3) and tstzrange is not IMMUTABLE).
 * 2. Seeds the database ONLY when it is empty (user count = 0). The seed itself
 *    is destructive (deleteMany), so it must never run against populated data.
 *
 * Uses DATABASE_URL from the environment; the build command points it at
 * DATABASE_URL_UNPOOLED for DDL reliability (Neon pooled endpoints are not
 * suitable for schema/constraint DDL).
 */
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";

const prisma = new PrismaClient();

async function ensureConstraint(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    "SELECT COUNT(*)::int AS n FROM pg_constraint WHERE conname = 'booking_no_overlap_active'",
  );
  if (rows[0]?.n === 0) {
    await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS btree_gist");
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Booking" ADD CONSTRAINT booking_no_overlap_active ` +
        `EXCLUDE USING gist ("facilityId" WITH =, tsrange("startAt", "endAt") WITH &&) ` +
        `WHERE ("status" IN ('PENDING', 'CONFIRMED'))`,
    );
    console.log("[deploy-db] exclusion constraint created");
  } else {
    console.log("[deploy-db] exclusion constraint already present — skipped");
  }
}

async function seedIfEmpty(): Promise<void> {
  const users = await prisma.user.count();
  if (users > 0) {
    console.log(`[deploy-db] seed skipped — database already has ${users} users`);
    return;
  }
  console.log("[deploy-db] empty database — running seed");
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env: process.env });
}

async function main(): Promise<void> {
  await ensureConstraint();
  await seedIfEmpty();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("[deploy-db] failed", error);
    await prisma.$disconnect();
    process.exit(1);
  });
