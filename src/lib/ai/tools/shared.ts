/**
 * Shared shaping helpers for the assistant tools: one venue card shape,
 * one rating basis, one price basis — so search, profile, compare and
 * the public pages can never quietly disagree (audit §7.3).
 */
import { effectiveRating } from "@/lib/geo/rank";
import { facilityMinPrice } from "@/lib/booking/logic";
import { venueProvenance, type ProvenanceKind } from "../types";
import { foldVi } from "../text";
import type { PrismaClient } from "@prisma/client";

export interface VenueRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  address: string;
  district: string;
  city: string;
  venueType: string;
  status: string;
  verified: boolean;
  source: string;
  instantBooking: boolean;
  ratingAvg: number;
  ratingCount: number;
  googleRating: number | null;
  googleRatingCount: number | null;
  beginnerFriendly: boolean;
  familyFriendly: boolean;
  latitude: number | null;
  longitude: number | null;
  cancelFullBeforeHours: number;
  cancelPartialBeforeHours: number;
  cancelPartialFeePercent: number;
  sports: { sport: { slug: string; name: string } }[];
  facilities: {
    id: string;
    name: string;
    surface: string | null;
    capacity: number;
    sport: { slug: string; name: string };
    priceRules: { ruleType: string; pricePerHour: number }[];
  }[];
  amenities: { name: string }[];
}

export interface VenueCardData {
  venueId: string;
  slug: string;
  name: string;
  /** District + address always travel with the name so same-named
   * venues in different districts are never confused. */
  district: string;
  address: string;
  sports: { slug: string; name: string }[];
  /** The rating basis is explicit: Google aggregate when present. */
  rating: {
    value: number;
    count: number | null;
    source: "google" | "in_app";
  };
  googleRating: number | null;
  googleRatingCount: number | null;
  inAppRating: number;
  inAppRatingCount: number;
  /** Cheapest hourly reference price across the venue's facilities. A
   * MINIMUM for orientation only — never the price of a specific slot. */
  minReferenceHourlyPrice: number | null;
  priceType: ProvenanceKind;
  detailUrl: string;
}

export function minPriceOf(row: VenueRow): number | null {
  const prices = row.facilities
    .map((f) => facilityMinPrice(f.priceRules))
    .filter((p): p is number => p !== null);
  return prices.length > 0 ? Math.min(...prices) : null;
}

export function shapeVenueCard(row: VenueRow): VenueCardData {
  const prov = venueProvenance(row.source);
  const eff = effectiveRating({
    ratingAvg: row.ratingAvg,
    googleRating: row.googleRating,
    minPrice: null,
    latitude: row.latitude,
    longitude: row.longitude,
  });
  return {
    venueId: row.id,
    slug: row.slug,
    name: row.name,
    district: row.district,
    address: row.address,
    sports: row.sports.map((s) => ({ slug: s.sport.slug, name: s.sport.name })),
    rating:
      row.googleRating != null
        ? { value: row.googleRating, count: row.googleRatingCount, source: "google" }
        : { value: row.ratingAvg, count: row.ratingCount, source: "in_app" },
    googleRating: row.googleRating,
    googleRatingCount: row.googleRatingCount,
    inAppRating: row.ratingAvg,
    inAppRatingCount: row.ratingCount,
    minReferenceHourlyPrice: minPriceOf(row),
    priceType: prov.prices,
    detailUrl: `/venues/${row.slug}`,
  };
}

export const VENUE_INCLUDE = {
  sports: { include: { sport: true } },
  facilities: { include: { priceRules: true, sport: true } },
  amenities: true,
} as const;

/** English/variant sport names a model may produce → canonical slug.
 * Canonical slugs themselves and folded Vietnamese names ("cau long"
 * → cau-long) are resolved without this table; the table only covers
 * names that folding cannot fix. */
const SPORT_SLUG_ALIASES: Record<string, string> = {
  badminton: "cau-long",
  tennis: "quan-vot",
  basketball: "bong-ro",
  swimming: "boi-loi",
  "swimming-pool": "boi-loi",
  soccer: "bong-da-mini",
  football: "bong-da-mini",
  "mini-football": "bong-da-mini",
  futsal: "bong-da-mini",
};

export type SportResolution =
  | { ok: true; slug: string }
  | { ok: false; validSlugs: string[] };

/**
 * Resolve a model-supplied sportSlug against the sports that actually
 * exist. An unknown sport must NEVER degrade into a silent empty
 * result (the model would report "no venues" for a sport the platform
 * has): callers turn a failed resolution into an UNSUPPORTED_FILTER
 * error listing the valid slugs, so the model can correct itself.
 */
export async function resolveSportSlug(
  db: PrismaClient,
  raw: string,
): Promise<SportResolution> {
  const sports = await db.sport.findMany({ select: { slug: true, name: true } });
  const validSlugs = sports.map((s) => s.slug);
  if (validSlugs.includes(raw)) return { ok: true, slug: raw };
  const folded = foldVi(raw).trim().replace(/\s+/g, "-");
  if (validSlugs.includes(folded)) return { ok: true, slug: folded };
  const byName = sports.find((s) => foldVi(s.name).replace(/\s+/g, "-") === folded);
  if (byName) return { ok: true, slug: byName.slug };
  const alias = SPORT_SLUG_ALIASES[folded];
  if (alias && validSlugs.includes(alias)) return { ok: true, slug: alias };
  return { ok: false, validSlugs };
}
