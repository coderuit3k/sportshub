/**
 * REAL venue catalog importer — converges the database onto the 119
 * real Ho Chi Minh City venues harvested from Google Maps
 * (prisma/real-venues-data.ts), replacing the fictional sample
 * catalog. Wired into prisma/deploy-db.ts (production builds, after
 * the fictional catalog step) and into prisma/seed.ts (local dev), so
 * both databases converge on the same catalog.
 *
 * Behaviour:
 * - Idempotent. The swap runs only when the database disagrees with
 *   the data: any venue with source != "google" exists, a "google"
 *   venue whose slug is not in the data set exists (stale), or the
 *   google-venue count differs from the data count. Once converged,
 *   repeat runs only re-sync the Google reviews (below).
 * - PURGE: every non-google venue (plus stale google venues) is
 *   deleted with the complete FK-closure machinery shared with the
 *   fictional catalog (catalog-store.ts → deleteRetiredVenue):
 *   per-venue transactions with TX_OPTIONS, a booking pre-scan that
 *   REFUSES venues with LIVE bookings (PENDING / CONFIRMED /
 *   COMPLETED — bookings are financial records and live ones are
 *   never deleted by a catalog step), loud per-venue failure
 *   logging, and a throw at the end if anything was blocked or
 *   failed — a half-swapped catalog never ships silently. One
 *   deliberate difference from the owner-facing removal guard: a
 *   venue whose bookings are ALL in terminal dead states
 *   (DEAD_BOOKING_STATUSES — e.g. the CANCELLED smoke-test booking
 *   sitting on a fictional venue in production) IS purgeable; those
 *   dead booking rows, with their status history and payments, are
 *   deleted inside the same closure and counted in the summary as
 *   deadBookingsRemoved.
 * - INSERT: missing real venues are created in one transaction each,
 *   owned by the seed owner (owner@sportshub.local, looked up — not
 *   created; if the account is absent the inserts are skipped with a
 *   loud error and the final count check fails the step). Each venue
 *   gets one facility per sport it offers (surface/capacity defaults
 *   from venue-catalog.ts, price rules inside the sport's reference
 *   band), normalized opening hours on all 7 days, status APPROVED,
 *   instantBooking = false (no real owner has claimed these venues
 *   yet, so bookings start as owner-approval), and the harvested
 *   Google rating aggregate stored on googleRating /
 *   googleRatingCount with source = "google". The in-app ratingAvg /
 *   ratingCount stay 0 — Google numbers are never mixed into them.
 * - GOOGLE REVIEWS: on EVERY run, each real venue's GoogleReview
 *   rows are replaced with the rows from
 *   prisma/real-reviews-data.ts matched by venue slug (delete +
 *   insert; a no-op while that module is an empty stub).
 * - The run ends with a loud summary line and throws unless the
 *   final google-venue count equals the data count (119).
 */
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  CATALOG_OWNER_EMAIL,
  DEAD_BOOKING_STATUSES,
  TX_OPTIONS,
  deleteRetiredVenue,
  getOrCreateSports,
} from "./catalog-store";
import {
  KNOWN_AMENITIES,
  SPORT_DEFS,
  SPORT_FACILITY_DEFAULTS,
  SPORT_PRICE_RANGES,
  type CatalogPriceRule,
  type SportSlug,
} from "./venue-catalog";
import { REAL_VENUES, normalizeOpenHours, type RealVenue } from "./real-venues-data";
import { REAL_GOOGLE_REVIEWS } from "./real-reviews-data";

type Db = PrismaClient;

const round3k = (v: number) => Math.round(v / 1000) * 1000;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Reference price rules for one real-venue facility, mirroring the
 * fictional generator's shape (OFF_PEAK up to 17:00, PEAK after,
 * WEEKEND flat) with every price inside the sport's band. The
 * off-peak price is the band midpoint — deterministic, owner-editable
 * later; these are platform reference prices, not the venue's own.
 */
export function buildSportPriceRules(
  sportSlug: SportSlug,
  openTime: string,
  closeTime: string,
): CatalogPriceRule[] {
  const [priceMin, priceMax] = SPORT_PRICE_RANGES[sportSlug];
  const offPeak = round3k((priceMin + priceMax) / 2);
  const weekend = clamp(round3k(offPeak * 1.15), priceMin, priceMax);
  const peak = clamp(round3k(offPeak * 1.35), priceMin, priceMax);
  const openHour = Number(openTime.slice(0, 2));
  const closeHourRaw = Number(closeTime.slice(0, 2));
  const closeHour = closeHourRaw === 0 ? 24 : closeHourRaw; // "00:00" = midnight
  // A venue closing at/before 17:00 still needs a non-degenerate peak window.
  const peakEndHour = closeHour <= 17 ? 18 : closeHour;
  return [
    { ruleType: "OFF_PEAK", pricePerHour: offPeak, startHour: openHour, endHour: 17 },
    { ruleType: "PEAK", pricePerHour: peak, startHour: 17, endHour: peakEndHour },
    { ruleType: "WEEKEND", pricePerHour: weekend, isWeekend: true },
  ];
}

/** Insert one real venue with all its children, atomically (the
 * insertCatalogVenue pattern from catalog-store.ts). */
async function insertRealVenue(
  prisma: Db,
  def: RealVenue,
  sportIds: Record<string, string>,
  ownerId: string,
): Promise<void> {
  const venueId = randomUUID();
  const { openTime, closeTime } = normalizeOpenHours(def.openHours);
  const primaryDefaults = SPORT_FACILITY_DEFAULTS[def.sportSlugs[0]];
  const description = def.sportSlugs
    .map((s) => SPORT_DEFS.find((d) => d.slug === s)?.description ?? "")
    .filter(Boolean)
    .join(" ");
  const facilities = def.sportSlugs.map((sportSlug) => {
    const defaults = SPORT_FACILITY_DEFAULTS[sportSlug];
    return {
      id: randomUUID(),
      venueId,
      sportId: sportIds[sportSlug],
      name: defaults.facilityName,
      surface: defaults.surface,
      capacity: defaults.capacity,
      priceRules: buildSportPriceRules(sportSlug, openTime, closeTime),
    };
  });

  await prisma.$transaction(async (tx) => {
    await tx.venue.create({
      data: {
        id: venueId,
        slug: def.slug,
        name: def.name,
        description,
        address: def.address,
        district: def.district,
        latitude: def.latitude,
        longitude: def.longitude,
        venueType: primaryDefaults.venueType,
        googleRating: def.googleRating,
        googleRatingCount: def.googleRatingCount,
        source: "google",
        instantBooking: false,
        status: "APPROVED",
        verified: true,
        ownerId,
      },
    });
    await tx.venueStaff.create({ data: { venueId, userId: ownerId, role: "OWNER" } });
    await tx.venueImage.create({
      data: { venueId, url: "gradient:green", caption: def.name, sortOrder: 0 },
    });
    await tx.venueSport.createMany({
      data: def.sportSlugs.map((sportSlug) => ({ venueId, sportId: sportIds[sportSlug] })),
    });
    await tx.venueAmenity.createMany({
      data: KNOWN_AMENITIES.map((name) => ({ venueId, name })),
    });
    await tx.operatingHour.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        venueId,
        dayOfWeek,
        openTime,
        closeTime,
      })),
    });
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
  }, TX_OPTIONS);
}

export interface EnsureRealCatalogResult {
  purged: number;
  purgeBlocked: number;
  /** Dead bookings (DEAD_BOOKING_STATUSES) deleted inside purged venues' closures. */
  deadBookingsRemoved: number;
  inserted: number;
  skipped: number;
  googleReviews: number;
  finalGoogleVenues: number;
  expected: number;
}

/**
 * Converge the database onto REAL_VENUES. See the file header for the
 * full contract. Throws when the swap is incomplete or the final
 * google-venue count disagrees with the data.
 */
export async function ensureRealCatalog(prisma: Db): Promise<EnsureRealCatalogResult> {
  const expected = REAL_VENUES.length;
  const dataSlugs = new Set(REAL_VENUES.map((v) => v.slug));

  const allVenues = await prisma.venue.findMany({
    select: { id: true, slug: true, source: true },
  });
  const nonGoogle = allVenues.filter((v) => v.source !== "google");
  const googleVenues = allVenues.filter((v) => v.source === "google");
  const staleGoogle = googleVenues.filter((v) => !dataSlugs.has(v.slug));
  const needsSwap =
    nonGoogle.length > 0 || staleGoogle.length > 0 || googleVenues.length !== expected;

  let purged = 0;
  let deadBookingsRemoved = 0;
  let inserted = 0;
  let skipped = 0;
  const purgeBlocked: Array<{ slug: string; bookings: number }> = [];
  const purgeFailures: Array<{ slug: string; error: string }> = [];
  const insertFailures: Array<{ slug: string; error: string }> = [];

  if (!needsSwap) {
    skipped = googleVenues.length;
    console.log(
      `[real-catalog] catalog already converged (${expected} google venues) — swap skipped`,
    );
  } else {
    /* ---------------- PURGE: non-google + stale google venues -------- */
    const targets = [...nonGoogle, ...staleGoogle];
    for (const target of targets) {
      // Booking pre-scan (the retired-venue removal guard, with ONE
      // deliberate difference): a venue referenced by any LIVE
      // booking — directly or through one of its facilities — is
      // never deleted by a catalog step. Bookings in terminal dead
      // states (DEAD_BOOKING_STATUSES) do NOT block: they are deleted
      // with the venue inside deleteRetiredVenue's closure (the
      // purgeDeadBookings opt-in) and counted below.
      const facilities = await prisma.facility.findMany({
        where: { venueId: target.id },
        select: { id: true },
      });
      const liveBookings = await prisma.booking.count({
        where: {
          OR: [
            { venueId: target.id },
            ...(facilities.length > 0
              ? [{ facilityId: { in: facilities.map((f) => f.id) } }]
              : []),
          ],
          status: { notIn: [...DEAD_BOOKING_STATUSES] },
        },
      });
      if (liveBookings > 0) {
        purgeBlocked.push({ slug: target.slug, bookings: liveBookings });
        console.error(
          `[real-catalog] REFUSED purge of venue ${target.slug}: it has ${liveBookings} live booking(s) — manual cleanup required`,
        );
        continue;
      }
      try {
        const { deadBookingsRemoved: removedHere } = await deleteRetiredVenue(prisma, target.id, {
          purgeDeadBookings: true,
        });
        purged += 1;
        deadBookingsRemoved += removedHere;
        console.log(
          `[real-catalog] purged venue ${target.slug} (source=${target.source})` +
            (removedHere > 0 ? ` — removed ${removedHere} dead booking(s) with it` : ""),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        purgeFailures.push({ slug: target.slug, error: message });
        console.error(`[real-catalog] FAILED purge of venue ${target.slug}: ${message}`);
      }
    }

    /* ---------------- INSERT: missing real venues -------------------- */
    const owner = await prisma.user.findUnique({ where: { email: CATALOG_OWNER_EMAIL } });
    if (!owner) {
      console.error(
        `[real-catalog] OWNER MISSING: no user with email ${CATALOG_OWNER_EMAIL} — ` +
          `skipping all real-venue inserts (the final count check will fail this step)`,
      );
    } else {
      const sportIds = await getOrCreateSports(prisma);
      const remainingSlugs = new Set(
        (
          await prisma.venue.findMany({
            where: { source: "google" },
            select: { slug: true },
          })
        ).map((v) => v.slug),
      );
      let processed = 0;
      for (const def of REAL_VENUES) {
        processed += 1;
        if (remainingSlugs.has(def.slug)) {
          skipped += 1;
          continue;
        }
        try {
          await insertRealVenue(prisma, def, sportIds, owner.id);
          inserted += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          insertFailures.push({ slug: def.slug, error: message });
          console.error(`[real-catalog] FAILED insert of real venue ${def.slug}: ${message}`);
        }
        if (processed % 25 === 0) {
          console.log(
            `[real-catalog] progress ${processed}/${expected}: inserted=${inserted} ` +
              `skipped=${skipped} failed=${insertFailures.length}`,
          );
        }
      }
    }
  }

  /* ---------------- GOOGLE REVIEWS sync (every run) ------------------ */
  const reviewsBySlug = new Map<string, typeof REAL_GOOGLE_REVIEWS>();
  for (const review of REAL_GOOGLE_REVIEWS) {
    const list = reviewsBySlug.get(review.venueSlug) ?? [];
    list.push(review);
    reviewsBySlug.set(review.venueSlug, list);
  }
  const googleVenueIds = new Map(
    (
      await prisma.venue.findMany({
        where: { source: "google" },
        select: { id: true, slug: true },
      })
    ).map((v) => [v.slug, v.id]),
  );
  let googleReviews = 0;
  for (const def of REAL_VENUES) {
    const venueId = googleVenueIds.get(def.slug);
    if (!venueId) continue;
    const rows = reviewsBySlug.get(def.slug) ?? [];
    await prisma.googleReview.deleteMany({ where: { venueId } });
    if (rows.length > 0) {
      await prisma.googleReview.createMany({
        data: rows.map((r) => ({
          venueId,
          authorName: r.authorName,
          rating: r.rating,
          text: r.text,
          relativeTime: r.relativeTime,
        })),
      });
    }
    googleReviews += rows.length;
  }

  /* ---------------- Final verification ------------------------------- */
  const finalGoogleVenues = await prisma.venue.count({ where: { source: "google" } });
  console.log(
    `[real-catalog] swap summary: purged=${purged} purgeBlocked=${purgeBlocked.length} ` +
      `purgeFailed=${purgeFailures.length} deadBookingsRemoved=${deadBookingsRemoved} ` +
      `inserted=${inserted} skipped=${skipped} ` +
      `insertFailed=${insertFailures.length} googleReviews=${googleReviews} ` +
      `finalGoogleVenues=${finalGoogleVenues} expected=${expected}`,
  );
  if (
    purgeBlocked.length > 0 ||
    purgeFailures.length > 0 ||
    insertFailures.length > 0 ||
    finalGoogleVenues !== expected
  ) {
    throw new Error(
      `ensureRealCatalog incomplete: final google venues ${finalGoogleVenues} != expected ${expected}; ` +
        `${purgeBlocked.length} purge(s) blocked by bookings ` +
        `[${purgeBlocked.map((b) => `${b.slug} (${b.bookings} bookings)`).join(", ")}]; ` +
        `${purgeFailures.length} purge(s) failed [${purgeFailures.map((f) => f.slug).join(", ")}]; ` +
        `${insertFailures.length} insert(s) failed [${insertFailures.map((f) => f.slug).join(", ")}]`,
    );
  }
  return {
    purged,
    purgeBlocked: purgeBlocked.length,
    deadBookingsRemoved,
    inserted,
    skipped,
    googleReviews,
    finalGoogleVenues,
    expected,
  };
}
