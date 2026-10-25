/**
 * Database side of the generated venue catalog (prisma/venue-catalog.ts).
 *
 * Two entry points share one insert path:
 * - prisma/seed.ts calls `ensureVenueCatalog` after wiping + reseeding
 *   the flagships, so a fresh local DB ends up with the full catalog.
 * - prisma/deploy-db.ts calls it on every production build: it inserts
 *   ONLY the catalog venues whose slug is still missing (plus their
 *   sports / facilities / price rules / amenities / hours), never
 *   modifies or deletes existing rows, and never touches bookings or
 *   unrelated users — so repeat runs are a no-op once complete.
 *
 * Ownership: catalog venues belong to the seed owner account
 * (owner@sportshub.local). The ensure-step get-or-creates that account
 * by email (same credentials/name as the seed) without touching any
 * other user.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
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

/** Insert one catalog venue with everything the detail page renders. */
export async function insertCatalogVenue(
  prisma: Db,
  def: CatalogVenue,
  sportIds: Record<string, string>,
  ownerId: string,
): Promise<string> {
  const venue = await prisma.venue.create({
    data: {
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
  await prisma.venueStaff.create({ data: { venueId: venue.id, userId: ownerId, role: "OWNER" } });
  await prisma.venueImage.create({ data: { venueId: venue.id, url: "gradient:green", caption: def.name, sortOrder: 0 } });
  await prisma.venueSport.create({ data: { venueId: venue.id, sportId: sportIds[def.primarySportSlug] } });
  if (def.amenities.length > 0) {
    await prisma.venueAmenity.createMany({
      data: def.amenities.map((name) => ({ venueId: venue.id, name })),
    });
  }
  await prisma.operatingHour.createMany({
    data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      venueId: venue.id,
      dayOfWeek,
      openTime: def.openTime,
      closeTime: def.closeTime,
    })),
  });
  for (const f of def.facilities) {
    const facility = await prisma.facility.create({
      data: {
        venueId: venue.id,
        sportId: sportIds[def.primarySportSlug],
        name: f.name,
        surface: f.surface,
        capacity: f.capacity,
      },
    });
    await prisma.priceRule.createMany({
      data: f.priceRules.map((r) => ({
        facilityId: facility.id,
        ruleType: r.ruleType,
        pricePerHour: r.pricePerHour,
        startHour: r.startHour ?? null,
        endHour: r.endHour ?? null,
        isWeekend: r.isWeekend ?? null,
      })),
    });
  }
  return venue.id;
}

/**
 * Idempotently top the database up to the full generated catalog.
 * Returns how many venues were inserted vs already present.
 */
export async function ensureVenueCatalog(prisma: Db): Promise<{ inserted: number; skipped: number }> {
  const owner = await getOrCreateCatalogOwner(prisma);
  const sportIds = await getOrCreateSports(prisma);
  let inserted = 0;
  let skipped = 0;
  for (const def of CATALOG_VENUES) {
    const existing = await prisma.venue.findUnique({ where: { slug: def.slug }, select: { id: true } });
    if (existing) {
      skipped += 1;
      continue;
    }
    await insertCatalogVenue(prisma, def, sportIds, owner.id);
    inserted += 1;
  }
  return { inserted, skipped };
}
