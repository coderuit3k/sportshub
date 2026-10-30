/**
 * PostGIS radius-search tests run against an isolated schema in the
 * explicit TEST_DATABASE_URL database; missing test configuration fails.
 *
 * Fixture geography (centre = TP. Thủ Đức, 10.8503 / 106.7553):
 * - geo_zero  at the centre            → 0 km
 * - geo_mid   at +0.0197°/+0.0147°     → ≈2.7 km
 * - geo_edge  at +0.044° lat           → ≈4.9 km (inside 5, outside 4)
 * - geo_far   at +0.047° lat           → ≈5.2 km (outside 5)
 * - geo_nopos no coordinates           → never matches
 * - geo_pend  PENDING_APPROVAL at centre → never matches (not public)
 */
import { createTestDb } from "../db";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensurePostgis } from "../../prisma/postgis";
import { findVenuesWithinRadius } from "@/lib/geo/radius";

const PG_URL = process.env.TEST_DATABASE_URL;
const CENTRE = { lat: 10.8503, lng: 106.7553 };

let db: PrismaClient;
let cleanup: () => Promise<void>;

const createPgClient = createTestDb;

async function seed(db: PrismaClient): Promise<void> {
  await db.venue.deleteMany({ where: { id: { startsWith: "geo_" } } });
  await db.user.deleteMany({ where: { email: "geo-owner@test.local" } });
  const owner = await db.user.create({
    data: { email: "geo-owner@test.local", name: "Geo Owner", passwordHash: "x", role: "OWNER" },
  });
  const badminton = await db.sport.upsert({
    where: { slug: "cau-long" },
    update: {},
    create: { name: "Cầu lông", slug: "cau-long" },
  });
  const mk = (
    id: string,
    lat: number | null,
    lng: number | null,
    status = "APPROVED",
  ) =>
    db.venue.create({
      data: {
        id, slug: id, name: `Venue ${id}`, description: "geo fixture", address: "1 Geo St",
        district: "Thủ Đức", latitude: lat, longitude: lng, status,
        source: "google", ownerId: owner.id,
      },
    });
  await mk("geo_zero", CENTRE.lat, CENTRE.lng);
  await mk("geo_mid", 10.87, 106.77);
  await mk("geo_edge", CENTRE.lat + 0.044, CENTRE.lng);
  await mk("geo_far", CENTRE.lat + 0.047, CENTRE.lng);
  await mk("geo_nopos", null, null);
  await mk("geo_pend", CENTRE.lat, CENTRE.lng, "PENDING_APPROVAL");
  await db.venueSport.create({ data: { venueId: "geo_zero", sportId: badminton.id } });
}

describe("postgis radius search (PostgreSQL)", () => {
  beforeAll(async () => {
    const f = await createPgClient(PG_URL!);
    db = f.db;
    cleanup = f.cleanup;
    await ensurePostgis(db);
    await seed(db);
  }, 180_000);
  afterAll(async () => {
    await cleanup?.();
  });

  it("ensurePostgis installs the extension — idempotently", async () => {
    const first = await ensurePostgis(db);
    expect(first.extensionInstalled).toBe(true);
    // 5 venues carry coordinates (zero/mid/edge/far + the pending one —
    // the count is status-agnostic; the QUERY filters by status)
    expect(first.venuesWithCoordinates).toBe(5);
    const second = await ensurePostgis(db);
    expect(second).toEqual(first);
  });

  it("radius 5 km returns the in-range public venues, ordered by distance", async () => {
    const hits = await findVenuesWithinRadius(db, { ...CENTRE, radiusKm: 5 });
    expect(hits.map((h) => h.venueId)).toEqual(["geo_zero", "geo_mid", "geo_edge"]);
    expect(hits[0].distanceKm).toBeLessThan(0.01);
    expect(hits[1].distanceKm).toBeGreaterThan(2);
    expect(hits[1].distanceKm).toBeLessThan(3.5);
    expect(hits[2].distanceKm).toBeGreaterThan(4.5);
    expect(hits[2].distanceKm).toBeLessThan(5);
  });

  it("radius boundaries are honoured exactly (4 km excludes the ≈4.9 km venue)", async () => {
    const hits = await findVenuesWithinRadius(db, { ...CENTRE, radiusKm: 4 });
    expect(hits.map((h) => h.venueId)).toEqual(["geo_zero", "geo_mid"]);
  });

  it("queries always use the venue's current coordinates (point computed inline)", async () => {
    await db.venue.update({
      where: { id: "geo_far" },
      data: { latitude: CENTRE.lat + 0.01 }, // ≈1.1 km — now inside 5 km
    });
    const hits = await findVenuesWithinRadius(db, { ...CENTRE, radiusKm: 5 });
    expect(hits.map((h) => h.venueId)).toContain("geo_far");
    await db.venue.update({
      where: { id: "geo_far" },
      data: { latitude: CENTRE.lat + 0.047 }, // restore
    });
  });

  it("sport filter applies on top of the radius", async () => {
    const hits = await findVenuesWithinRadius(db, { ...CENTRE, radiusKm: 5, sportSlug: "cau-long" });
    expect(hits.map((h) => h.venueId)).toEqual(["geo_zero"]);
    const none = await findVenuesWithinRadius(db, { ...CENTRE, radiusKm: 5, sportSlug: "quan-vot" });
    expect(none).toEqual([]);
  });

  it("invalid coordinates and radii are rejected before hitting the database", async () => {
    await expect(findVenuesWithinRadius(db, { lat: 91, lng: 0, radiusKm: 5 })).rejects.toThrow(RangeError);
    await expect(findVenuesWithinRadius(db, { lat: 0, lng: 0, radiusKm: 0 })).rejects.toThrow(RangeError);
    await expect(findVenuesWithinRadius(db, { lat: 0, lng: 0, radiusKm: 101 })).rejects.toThrow(RangeError);
  });
});
