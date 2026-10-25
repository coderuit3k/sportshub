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
 * 4. Scrubs legacy "demo" wording from production rows that were seeded with
 *    the old copy (venue names/addresses/descriptions, review comments,
 *    session descriptions, booking notifications). Exact-match replacements,
 *    only rows that actually change are updated — a no-op once scrubbed.
 * 5. Tops the venue catalog up to the generated catalog
 *    (prisma/venue-catalog.ts — 29 extra venues per sport, 30 APPROVED
 *    per sport in total): inserts only venues whose slug is missing,
 *    never modifies existing rows. NOT gated on user count — it runs on
 *    every build and is a no-op once the catalog is complete.
 *
 * Uses DATABASE_URL from the environment; the build command points it at
 * DATABASE_URL_UNPOOLED for DDL reliability (Neon pooled endpoints are not
 * suitable for schema/constraint DDL).
 */
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { ensureVenueCatalog } from "./catalog-store";

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

function applyReplacements(text: string, pairs: Array<[string, string]>): string {
  let out = text;
  for (const [from, to] of pairs) out = out.split(from).join(to);
  return out;
}

const OLD_SESSION_DESCRIPTION = "Kèo cộng đồng demo — chưa phải đặt sân đã xác nhận.";
const NEW_SESSION_DESCRIPTION = "Kèo cộng đồng mở — tham gia tự do, chưa phải đặt sân đã xác nhận.";

/**
 * Production was originally seeded with copy that labelled data as demo /
 * simulated. The site copy has since been neutralised, so rewrite the stored
 * rows to match. Idempotent: rows are only updated when a replacement
 * actually changes their text, so repeat runs are a no-op.
 * Exported for local verification (see DEPLOY_DB_IMPORT_ONLY below).
 */
export async function scrubDemoWording(): Promise<void> {
  let venuesUpdated = 0;
  const venues = await prisma.venue.findMany({
    select: { id: true, name: true, address: true, description: true },
  });
  for (const v of venues) {
    const name = applyReplacements(v.name, [[" (demo hư cấu)", ""]]);
    const address = applyReplacements(v.address, [[" (địa chỉ demo)", ""]]);
    const description = applyReplacements(v.description, [
      [" Dữ liệu demo hư cấu.", ""],
      ["Dữ liệu demo hư cấu.", ""],
    ]);
    if (name !== v.name || address !== v.address || description !== v.description) {
      await prisma.venue.update({ where: { id: v.id }, data: { name, address, description } });
      venuesUpdated++;
    }
  }

  let reviewsUpdated = 0;
  const reviews = await prisma.review.findMany({ select: { id: true, comment: true } });
  for (const r of reviews) {
    const comment = applyReplacements(r.comment, [[" (đánh giá seed/demo)", ""]]);
    if (comment !== r.comment) {
      await prisma.review.update({ where: { id: r.id }, data: { comment } });
      reviewsUpdated++;
    }
  }

  let sessionsUpdated = 0;
  const sessions = await prisma.sportsSession.findMany({ select: { id: true, description: true } });
  for (const s of sessions) {
    if (s.description === OLD_SESSION_DESCRIPTION) {
      await prisma.sportsSession.update({ where: { id: s.id }, data: { description: NEW_SESSION_DESCRIPTION } });
      sessionsUpdated++;
    }
  }

  const notificationFixes: Array<[string, string]> = [
    [" (thanh toán MÔ PHỎNG, chưa thu tiền thật)", ""],
    [" (thanh toán mô phỏng)", ""],
    ["hoàn mô phỏng: ", "hoàn: "],
    ["hoàn mô phỏng ", "hoàn "],
  ];
  let notificationsUpdated = 0;
  const notifications = await prisma.notification.findMany({ select: { id: true, title: true, body: true } });
  for (const n of notifications) {
    const title = applyReplacements(n.title, notificationFixes);
    const body = applyReplacements(n.body, notificationFixes);
    if (title !== n.title || body !== n.body) {
      await prisma.notification.update({ where: { id: n.id }, data: { title, body } });
      notificationsUpdated++;
    }
  }

  console.log(
    `[deploy-db] demo-wording scrub: venues=${venuesUpdated} reviews=${reviewsUpdated} ` +
      `sessions=${sessionsUpdated} notifications=${notificationsUpdated} updated`,
  );
}

async function main(): Promise<void> {
  await ensureConstraint();
  await seedIfEmpty();
  await backfillVenueCoordinates();
  await scrubDemoWording();
  const catalog = await ensureVenueCatalog(prisma);
  console.log(`[deploy-db] venue catalog: +${catalog.inserted} inserted, ${catalog.skipped} already present`);
}

// Guarded so local verification harnesses can import scrubDemoWording
// without triggering the full production bootstrap.
if (!process.env.DEPLOY_DB_IMPORT_ONLY) {
  main()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (error: unknown) => {
      console.error("[deploy-db] failed", error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
