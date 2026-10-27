import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureRealCatalog } from "../prisma/real-catalog";
import { REAL_GOOGLE_REVIEWS } from "../prisma/real-reviews-data";

/**
 * Importer integration test: ensureRealCatalog against a throwaway
 * SQLite database (created with `prisma db push` in a temp dir).
 * Covers the full swap (fictional purge + 119 real inserts), the
 * idempotent second run (pure no-op), and the booking guard: a venue
 * with LIVE bookings (PENDING / CONFIRMED) is refused and fails the
 * step loudly instead of being deleted, while a venue whose only
 * booking is CANCELLED purges cleanly — the dead booking (with its
 * status history and payments) is deleted inside the closure and
 * counted as deadBookingsRemoved.
 */

const REPO_ROOT = path.resolve(__dirname, "..");
const tmpDir = mkdtempSync(path.join(tmpdir(), "sportshub-real-catalog-"));
const dbPath = path.join(tmpDir, "test.db");
const dbUrl = `file:${dbPath}`;

function schemaEngineBinary(): string | undefined {
  const dir = path.join(REPO_ROOT, "node_modules", "@prisma", "engines");
  const found = readdirSync(dir).find((f) => f.startsWith("schema-engine-") && !f.endsWith(".md"));
  return found ? path.join(dir, found) : undefined;
}

let prisma: PrismaClient;
let ownerId: string;

async function makeFictionalVenue(slug: string): Promise<string> {
  const venue = await prisma.venue.create({
    data: {
      slug,
      name: `Fictional ${slug}`,
      description: "sample venue",
      address: "1 Nowhere",
      district: "Quận 1",
      ownerId,
    },
  });
  return venue.id;
}

beforeAll(async () => {
  const engine = schemaEngineBinary();
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      CHECKPOINT_DISABLE: "1",
      ...(engine && existsSync(engine) ? { PRISMA_SCHEMA_ENGINE_BINARY: engine } : {}),
    },
  });
  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const owner = await prisma.user.create({
    data: {
      email: "owner@sportshub.local",
      passwordHash: "x",
      name: "Seed Owner",
      role: "OWNER",
    },
  });
  ownerId = owner.id;
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ensureRealCatalog", () => {
  it("swaps a fictional catalog for the 119 real venues", async () => {
    await makeFictionalVenue("fictional-one");
    await makeFictionalVenue("fictional-two");

    const result = await ensureRealCatalog(prisma);
    expect(result.purged).toBe(2);
    expect(result.inserted).toBe(119);
    expect(result.finalGoogleVenues).toBe(119);
    expect(result.googleReviews).toBe(REAL_GOOGLE_REVIEWS.length); // every harvested row synced

    expect(await prisma.venue.count()).toBe(119);
    expect(await prisma.venue.count({ where: { source: "google" } })).toBe(119);
    expect(await prisma.venue.count({ where: { status: "APPROVED" } })).toBe(119);
    expect(await prisma.venue.findUnique({ where: { slug: "fictional-one" } })).toBeNull();

    const pooc = await prisma.venue.findUnique({
      where: { slug: "pooc-cau-long-pickleball" },
      include: { sports: true, facilities: true, hours: true },
    });
    expect(pooc?.googleRating).toBe(4.8);
    expect(pooc?.googleRatingCount).toBe(1449);
    expect(pooc?.ratingAvg).toBe(0); // Google numbers never leak into in-app aggregates
    expect(pooc?.instantBooking).toBe(false);
    expect(pooc?.sports).toHaveLength(2);
    expect(pooc?.facilities).toHaveLength(2);
    expect(pooc?.hours).toHaveLength(7);
  }, 120_000);

  it("is idempotent: a second run changes nothing", async () => {
    const before = await prisma.venue.findMany({ select: { id: true, slug: true }, orderBy: { slug: "asc" } });
    const result = await ensureRealCatalog(prisma);
    expect(result.purged).toBe(0);
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(119);
    expect(result.finalGoogleVenues).toBe(119);
    const after = await prisma.venue.findMany({ select: { id: true, slug: true }, orderBy: { slug: "asc" } });
    expect(after).toEqual(before); // same rows, not delete + re-insert
  }, 120_000);

  it("refuses to purge a venue with bookings, then converges once the booking is gone", async () => {
    const venueId = await makeFictionalVenue("fictional-with-booking");
    const sport = await prisma.sport.findFirstOrThrow();
    const facility = await prisma.facility.create({
      data: { venueId, sportId: sport.id, name: "Sân 01", capacity: 10 },
    });
    const player = await prisma.user.create({
      data: { email: "player@sportshub.local", passwordHash: "x", name: "Player", role: "PLAYER" },
    });
    const booking = await prisma.booking.create({
      data: {
        reference: "TEST-BLOCKED-1",
        userId: player.id,
        venueId,
        facilityId: facility.id,
        startAt: new Date("2030-01-01T10:00:00Z"),
        endAt: new Date("2030-01-01T11:00:00Z"),
        totalPrice: 100000,
        priceSnapshot: "{}",
        policySnapshot: "{}",
        idempotencyKey: "test-blocked-1",
      },
    });

    await expect(ensureRealCatalog(prisma)).rejects.toThrow(/blocked by bookings/);
    // The guarded venue survived untouched.
    expect(await prisma.venue.findUnique({ where: { slug: "fictional-with-booking" } })).not.toBeNull();

    await prisma.booking.delete({ where: { id: booking.id } });
    const result = await ensureRealCatalog(prisma);
    expect(result.purged).toBe(1);
    expect(result.finalGoogleVenues).toBe(119);
    expect(await prisma.venue.findUnique({ where: { slug: "fictional-with-booking" } })).toBeNull();
  }, 120_000);

  it("purges a venue whose only booking is CANCELLED, deleting the dead booking with it", async () => {
    const venueId = await makeFictionalVenue("fictional-cancelled-booking");
    const sport = await prisma.sport.findFirstOrThrow();
    const facility = await prisma.facility.create({
      data: { venueId, sportId: sport.id, name: "Sân 01", capacity: 10 },
    });
    const player = await prisma.user.create({
      data: { email: "cancelled-player@sportshub.local", passwordHash: "x", name: "Player", role: "PLAYER" },
    });
    const booking = await prisma.booking.create({
      data: {
        reference: "TEST-CANCELLED-1",
        userId: player.id,
        venueId,
        facilityId: facility.id,
        startAt: new Date("2030-01-02T10:00:00Z"),
        endAt: new Date("2030-01-02T11:00:00Z"),
        status: "CANCELLED",
        totalPrice: 100000,
        priceSnapshot: "{}",
        policySnapshot: "{}",
        idempotencyKey: "test-cancelled-1",
      },
    });
    await prisma.bookingStatusHistory.create({
      data: { bookingId: booking.id, toStatus: "CANCELLED" },
    });
    await prisma.payment.create({ data: { bookingId: booking.id, amount: 100000 } });

    const result = await ensureRealCatalog(prisma);
    expect(result.purged).toBe(1);
    expect(result.deadBookingsRemoved).toBe(1);
    expect(result.finalGoogleVenues).toBe(119);
    // Venue gone — and the dead booking went with it, history and
    // payments included, instead of blocking the purge.
    expect(await prisma.venue.findUnique({ where: { slug: "fictional-cancelled-booking" } })).toBeNull();
    expect(await prisma.booking.findUnique({ where: { id: booking.id } })).toBeNull();
    expect(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id } })).toBe(0);
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(0);
  }, 120_000);

  it("still refuses to purge a venue with a CONFIRMED booking", async () => {
    const venueId = await makeFictionalVenue("fictional-confirmed-booking");
    const sport = await prisma.sport.findFirstOrThrow();
    const facility = await prisma.facility.create({
      data: { venueId, sportId: sport.id, name: "Sân 01", capacity: 10 },
    });
    const player = await prisma.user.create({
      data: { email: "confirmed-player@sportshub.local", passwordHash: "x", name: "Player", role: "PLAYER" },
    });
    const booking = await prisma.booking.create({
      data: {
        reference: "TEST-CONFIRMED-1",
        userId: player.id,
        venueId,
        facilityId: facility.id,
        startAt: new Date("2030-01-03T10:00:00Z"),
        endAt: new Date("2030-01-03T11:00:00Z"),
        status: "CONFIRMED",
        totalPrice: 100000,
        priceSnapshot: "{}",
        policySnapshot: "{}",
        idempotencyKey: "test-confirmed-1",
      },
    });

    await expect(ensureRealCatalog(prisma)).rejects.toThrow(/blocked by bookings/);
    // Neither the venue nor the live booking was touched.
    expect(await prisma.venue.findUnique({ where: { slug: "fictional-confirmed-booking" } })).not.toBeNull();
    expect(await prisma.booking.findUnique({ where: { id: booking.id } })).not.toBeNull();

    await prisma.booking.delete({ where: { id: booking.id } });
    const result = await ensureRealCatalog(prisma);
    expect(result.purged).toBe(1);
    expect(result.deadBookingsRemoved).toBe(0);
    expect(result.finalGoogleVenues).toBe(119);
    expect(await prisma.venue.findUnique({ where: { slug: "fictional-confirmed-booking" } })).toBeNull();
  }, 120_000);
});
