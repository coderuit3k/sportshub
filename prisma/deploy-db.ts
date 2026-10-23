/**
 * Production database bootstrap — runs inside the Vercel build (see vercel.json),
 * after `prisma db push` against the PostgreSQL schema.
 *
 * 1. Ensures the booking_no_overlap_active exclusion constraint exists
 *    (same SQL as prisma/postgresql/booking_no_overlap.sql — tsrange variant,
 *    because Prisma maps DateTime to TIMESTAMP(3) and tstzrange is not IMMUTABLE).
 * 2. Seeds the database ONLY when it is empty (user count = 0). The seed itself
 *    is destructive (deleteMany), so it must never run against populated data.
 * 3. Backfills demo coordinates for seed venues whose latitude is still NULL
 *    (production was seeded before coordinates existed).
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

/**
 * Demo coordinates for the fictional seed venues (same values as prisma/seed.ts).
 * Production was seeded before coordinates existed, so venues there have NULL
 * latitude/longitude. Backfill fills them in — only where still NULL, so real
 * coordinates set later by venue owners are never overwritten.
 */
const DEMO_VENUE_COORDS: Array<{ slug: string; latitude: number; longitude: number }> = [
  { slug: "smash-arena-thu-duc", latitude: 10.8503, longitude: 106.7553 },
  { slug: "pickle-hub-binh-thanh", latitude: 10.8015, longitude: 106.71 },
  { slug: "sai-gon-mini-football-q7", latitude: 10.738, longitude: 106.713 },
  { slug: "riverside-tennis-q1", latitude: 10.782, longitude: 106.706 },
  { slug: "hoops-center-thu-duc", latitude: 10.858, longitude: 106.747 },
  { slug: "aqua-pool-q7", latitude: 10.725, longitude: 106.728 },
  { slug: "new-court-pending-binh-thanh", latitude: 10.805, longitude: 106.715 },
];

async function backfillVenueCoordinates(): Promise<void> {
  for (const v of DEMO_VENUE_COORDS) {
    const updated = await prisma.venue.updateMany({
      where: { slug: v.slug, latitude: null },
      data: { latitude: v.latitude, longitude: v.longitude },
    });
    if (updated.count > 0) {
      console.log(`[deploy-db] coordinates backfilled for ${v.slug}`);
    }
  }
}

async function main(): Promise<void> {
  await ensureConstraint();
  await seedIfEmpty();
  await backfillVenueCoordinates();
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
