/**
 * "Venues within a radius" — the runnable form of the query
 * "sân trong bán kính 5km", backed by PostGIS (docs/geo-radius.md).
 *
 * Usage:
 *   DATABASE_URL=postgresql://… npm run venues:near -- \
 *     --lat 10.8503 --lng 106.7553 --radius 5 [--sport cau-long] [--limit 20]
 *
 * Defaults: the centre of TP. Thủ Đức (10.8503, 106.7553), radius 5 km.
 * Requires the PostgreSQL Prisma client + PostGIS setup
 * (`npm run db:postgis`) — see docs/geo-radius.md.
 */
import { PrismaClient } from "@prisma/client";
import { findVenuesWithinRadius } from "../src/lib/geo/radius";

// Load .env like the Prisma CLI does (see scripts/setup-postgis.ts).
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the real environment.
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const lat = Number(arg("lat") ?? "10.8503");
  const lng = Number(arg("lng") ?? "106.7553");
  const radiusKm = Number(arg("radius") ?? "5");
  const sportSlug = arg("sport");
  const limit = Number(arg("limit") ?? "20");

  const db = new PrismaClient();
  try {
    const hits = await findVenuesWithinRadius(db, { lat, lng, radiusKm, sportSlug, limit });
    console.log(
      `${hits.length} sân trong bán kính ${radiusKm} km quanh (${lat}, ${lng})` +
        (sportSlug ? ` — môn: ${sportSlug}` : "") +
        ":",
    );
    for (const h of hits) {
      const rating =
        h.googleRating != null
          ? `${h.googleRating.toFixed(1)}★ Google (${h.googleRatingCount ?? 0})`
          : h.ratingCount > 0
            ? `${h.ratingAvg.toFixed(1)}★ SportsHub (${h.ratingCount})`
            : "chưa có đánh giá";
      console.log(
        `  ${h.distanceKm.toFixed(2).padStart(6)} km  ${h.name} — ${h.district} — ${rating}`,
      );
      console.log(`           ${h.address}`);
    }
    if (hits.length === 0) {
      console.log("  (không có sân nào — thử tăng --radius hoặc kiểm tra `npm run db:postgis`)");
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
