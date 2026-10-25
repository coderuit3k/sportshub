/**
 * Database side of the generated venue catalog (prisma/venue-catalog.ts).
 *
 * Two entry points share one insert path:
 * - prisma/seed.ts calls `ensureVenueCatalog` after wiping + reseeding
 *   the flagships, so a fresh local DB ends up with the full catalog.
 * - prisma/deploy-db.ts calls it on every production build: it inserts
 *   ONLY the catalog venues whose slug is still missing (plus their
 *   sports / facilities / price rules / amenities / hours), never
 *   modifies complete rows, and never touches bookings or unrelated
 *   users — so repeat runs are a no-op once the catalog is complete.
 *
 * Failure behaviour (hardened after the 2026-10-25 production incident,
 * where a build was interrupted mid-catalog and shipped 74/180 venues
 * silently):
 * - Every venue is inserted in ONE transaction, so a venue is never
 *   left half-written (row without its sport link / facilities).
 * - A venue that exists but is incomplete (e.g. missing its primary
 *   sport link after an interrupted run) is repaired — deleted (its
 *   children cascade) and re-inserted — unless it somehow has bookings,
 *   in which case it is reported as a failure instead of touched.
 * - Each venue is isolated: one venue's failure is logged with its slug
 *   and does NOT stop the remaining venues.
 * - At the end the step VERIFIES that every catalog venue is present
 *   and linked to its primary sport. Any failure or missing venue makes
 *   the step throw, which fails prisma/deploy-db.ts (exit 1) and
 *   therefore the build — a partial catalog can never ship silently.
 *
 * Ownership: catalog venues belong to the seed owner account
 * (owner@sportshub.local). The ensure-step get-or-creates that account
 * by email (same credentials/name as the seed) without touching any
 * other user.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { CATALOG_VENUES, SPORT_DEFS, type CatalogVenue } from "./venue-catalog";

/** The seed owner account that owns every catalog venue. */
export const CATALOG_OWNER_EMAIL = "owner@sportshub.local";

type Db = PrismaClient;

async function getOrCreateCatalogOwner(prisma: Db) {
  const existing = await prisma.user.findUnique({ where: { email: CATALOG_OWNER_EMAIL } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email: CATALOG_OWNER_EMAIL,
      passwordHash: await bcrypt.hash("Password123!", 10),
      name: "Trần Văn Hùng (Chủ sân)",
      role: "OWNER",
    },
  });
}

async function getOrCreateSports(prisma: Db): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const s of SPORT_DEFS) {
    const sport = await prisma.sport.upsert({
      where: { slug: s.slug },
      update: {},
      create: { name: s.name, slug: s.slug, icon: s.icon, description: s.description },
    });
    ids[s.slug] = sport.id;
  }
  return ids;
}

/**
 * Insert one catalog venue with everything the detail page renders,
 * atomically: the venue row and all of its children are written in a
 * single transaction, using createMany batches with client-generated
 * ids so the whole venue costs a handful of round trips.
 */
export async function insertCatalogVenue(
  prisma: Db,
  def: CatalogVenue,
  sportIds: Record<string, string>,
  ownerId: string,
): Promise<string> {
  const venueId = randomUUID();
  const sportId = sportIds[def.primarySportSlug];
  const facilities = def.facilities.map((f) => ({
    id: randomUUID(),
    venueId,
    sportId,
    name: f.name,
    surface: f.surface,
    capacity: f.capacity,
    priceRules: f.priceRules,
  }));

  await prisma.$transaction(async (tx) => {
    await tx.venue.create({
      data: {
        id: venueId,
        slug: def.slug,
        name: def.name,
        description: def.description,
        address: def.address,
        district: def.district,
        latitude: def.latitude,
        longitude: def.longitude,
        venueType: def.venueType,
        beginnerFriendly: def.beginnerFriendly,
        familyFriendly: def.familyFriendly,
        ratingAvg: def.ratingAvg,
        ratingCount: def.ratingCount,
        instantBooking: def.instantBooking,
        status: "APPROVED",
        verified: true,
        ownerId,
      },
    });
    await tx.venueStaff.create({ data: { venueId, userId: ownerId, role: "OWNER" } });
    await tx.venueImage.create({ data: { venueId, url: "gradient:green", caption: def.name, sortOrder: 0 } });
    await tx.venueSport.create({ data: { venueId, sportId } });
    if (def.amenities.length > 0) {
      await tx.venueAmenity.createMany({
        data: def.amenities.map((name) => ({ venueId, name })),
      });
    }
    await tx.operatingHour.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        venueId,
        dayOfWeek,
        openTime: def.openTime,
        closeTime: def.closeTime,
      })),
    });
    if (facilities.length > 0) {
      await tx.facility.createMany({
        data: facilities.map(({ priceRules: _priceRules, ...facility }) => facility),
      });
      await tx.priceRule.createMany({
        data: facilities.flatMap((f) =>
          f.priceRules.map((r) => ({
            facilityId: f.id,
            ruleType: r.ruleType,
            pricePerHour: r.pricePerHour,
            startHour: r.startHour ?? null,
            endHour: r.endHour ?? null,
            isWeekend: r.isWeekend ?? null,
          })),
        ),
      });
    }
  });
  return venueId;
}

export interface EnsureCatalogResult {
  inserted: number;
  skipped: number;
  /** Incomplete rows (present but missing the primary sport link) that were deleted and re-inserted. */
  repaired: number;
  /** Venues that could not be inserted/repaired this run. Non-zero ⇒ the step throws after the summary. */
  failed: number;
}

/**
 * Idempotently top the database up to the full generated catalog.
 *
 * Processes EVERY catalog venue even if individual ones fail, then
 * verifies completeness and throws if anything failed or is missing —
 * callers (prisma/deploy-db.ts) turn that into a non-zero exit, so a
 * partial catalog fails the build instead of shipping silently.
 */
export async function ensureVenueCatalog(prisma: Db): Promise<EnsureCatalogResult> {
  const owner = await getOrCreateCatalogOwner(prisma);
  const sportIds = await getOrCreateSports(prisma);
  const catalogSlugs = CATALOG_VENUES.map((v) => v.slug);

  const loadState = async () => {
    const rows = await prisma.venue.findMany({
      where: { slug: { in: catalogSlugs } },
      select: { id: true, slug: true, sports: { select: { sportId: true } } },
    });
    return new Map(rows.map((v) => [v.slug, v]));
  };
  const isComplete = (
    state: Awaited<ReturnType<typeof loadState>>,
    def: CatalogVenue,
  ): boolean => {
    const row = state.get(def.slug);
    return !!row && row.sports.some((s) => s.sportId === sportIds[def.primarySportSlug]);
  };

  const state = await loadState();
  let inserted = 0;
  let skipped = 0;
  let repaired = 0;
  const failures: Array<{ slug: string; error: string }> = [];

  let processed = 0;
  for (const def of CATALOG_VENUES) {
    processed += 1;
    if (isComplete(state, def)) {
      skipped += 1;
      continue;
    }
    const orphan = state.get(def.slug);
    try {
      if (orphan) {
        // Row exists but is incomplete (missing its primary sport link) —
        // the scar of an interrupted run. It was never bookable in that
        // state, but refuse to touch it if bookings somehow reference it.
        const bookingCount = await prisma.booking.count({
          where: { facility: { venueId: orphan.id } },
        });
        if (bookingCount > 0) {
          throw new Error(
            `venue row exists but is incomplete and has ${bookingCount} booking(s) — refusing to auto-repair`,
          );
        }
        await prisma.venue.delete({ where: { id: orphan.id } }); // children cascade
        await insertCatalogVenue(prisma, def, sportIds, owner.id);
        repaired += 1;
      } else {
        await insertCatalogVenue(prisma, def, sportIds, owner.id);
        inserted += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ slug: def.slug, error: message });
      console.error(`[catalog] FAILED ${def.slug}: ${message}`);
    }
    if (processed % 25 === 0) {
      console.log(
        `[catalog] progress ${processed}/${CATALOG_VENUES.length}: ` +
          `inserted=${inserted} skipped=${skipped} repaired=${repaired} failed=${failures.length}`,
      );
    }
  }

  // Final verification: re-read state and require EVERY catalog venue to
  // be present and linked to its primary sport.
  const finalState = await loadState();
  const missing = CATALOG_VENUES.filter((def) => !isComplete(finalState, def)).map(
    (def) => def.slug,
  );

  console.log(
    `[catalog] ensure summary: inserted=${inserted} skipped=${skipped} ` +
      `repaired=${repaired} failed=${failures.length} missing=${missing.length}`,
  );
  if (failures.length > 0 || missing.length > 0) {
    throw new Error(
      `ensureVenueCatalog incomplete: ${failures.length} venue(s) failed ` +
        `[${failures.map((f) => f.slug).join(", ")}]; ${missing.length} venue(s) ` +
        `missing/incomplete after run [${missing.join(", ")}]`,
    );
  }
  return { inserted, skipped, repaired, failed: failures.length };
}
