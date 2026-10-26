import { unstable_cache } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { storedPrimaryImageUrl } from "@/lib/venue-images";

/**
 * Cached PUBLIC reads (see docs/architecture.md → "Caching & rate limiting").
 *
 * Why the cache lives at the DATA layer: the public pages render per-request
 * (the cookie-based locale bails them out of Next's full-route/ISR cache),
 * but their payloads are locale-independent raw data. `unstable_cache`
 * collapses the repeated Prisma queries across requests/instances into one
 * DB hit per TTL window; translations and formatting still happen fresh on
 * every render, so a cached payload can never serve the wrong language.
 *
 * Every function returns plain serializable DTOs (no `Date` objects — the
 * data cache JSON-serializes its payload). Invalidation: mutations that
 * change public venue data call `revalidateTag("venues")`; TTL expiry is
 * the backstop.
 */

export const VENUES_TAG = "venues";
export const SESSIONS_TAG = "sessions";

/* ------------------------------------------------------------------ */
/* Homepage                                                            */
/* ------------------------------------------------------------------ */

export interface PublicSport {
  id: string;
  slug: string;
  name: string;
  venueCount: number;
}

export interface PublicVenueCard {
  id: string;
  slug: string;
  name: string;
  district: string;
  address: string;
  ratingAvg: number;
  ratingCount: number;
  beginnerFriendly: boolean;
  familyFriendly: boolean;
  minPrice: number | null;
  sports: { slug: string; name: string }[];
  primarySportSlug: string | null;
  /** Stored primary photo (Cloudflare R2), when the venue has one; null → the code map decides. */
  imageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface PublicSession {
  id: string;
  title: string;
  /** ISO string (cache-safe); convert with `new Date(...)` before formatting. */
  startAt: string;
  sportSlug: string;
  sportName: string;
  venueName: string | null;
  joinedCount: number;
  maxParticipants: number;
  costPerPerson: number;
}

function minPriceOf(facilities: { priceRules: { pricePerHour: number }[] }[]): number | null {
  return facilities.flatMap((f) => f.priceRules.map((r) => r.pricePerHour)).sort((a, b) => a - b)[0] ?? null;
}

export const getCachedSports = unstable_cache(
  async (): Promise<PublicSport[]> => {
    const sports = await prisma.sport.findMany();
    // Public counts: APPROVED venues only (the pending-approval venue
    // must not inflate the homepage grid numbers).
    const counts = await prisma.venueSport.groupBy({
      by: ["sportId"],
      where: { venue: { status: "APPROVED" } },
      _count: { _all: true },
    });
    const bySportId = new Map(counts.map((c) => [c.sportId, c._count._all]));
    return sports.map((s) => ({ id: s.id, slug: s.slug, name: s.name, venueCount: bySportId.get(s.id) ?? 0 }));
  },
  ["public:sports:v2"],
  { revalidate: 300, tags: [VENUES_TAG] },
);

export const getCachedFeaturedVenues = unstable_cache(
  async (): Promise<PublicVenueCard[]> => {
    const venues = await prisma.venue.findMany({
      where: { status: "APPROVED" },
      include: {
        sports: { include: { sport: true } },
        facilities: { include: { priceRules: true } },
        images: { orderBy: { sortOrder: "asc" }, select: { url: true } },
      },
      orderBy: { ratingAvg: "desc" },
      take: 6,
    });
    return venues.map((v) => ({
      id: v.id,
      slug: v.slug,
      name: v.name,
      district: v.district,
      address: v.address,
      ratingAvg: v.ratingAvg,
      ratingCount: v.ratingCount,
      beginnerFriendly: v.beginnerFriendly,
      familyFriendly: v.familyFriendly,
      minPrice: minPriceOf(v.facilities),
      sports: v.sports.map((s) => ({ slug: s.sport.slug, name: s.sport.name })),
      primarySportSlug: v.sports[0]?.sport.slug ?? null,
      imageUrl: storedPrimaryImageUrl(v.images),
      latitude: v.latitude,
      longitude: v.longitude,
    }));
  },
  ["public:featured-venues:v2"],
  { revalidate: 300, tags: [VENUES_TAG] },
);

/**
 * Open sessions from `todayStartISO` (00:00 Asia/Ho_Chi_Minh). The day is a
 * cache argument, so the key rotates at midnight; within a day the 300 s
 * TTL bounds how stale "from today" can be.
 */
export const getCachedHomeSessions = unstable_cache(
  async (todayStartISO: string): Promise<PublicSession[]> => {
    const sessions = await prisma.sportsSession.findMany({
      where: { status: { in: ["OPEN", "FULL"] }, startAt: { gte: new Date(todayStartISO) } },
      include: { sport: true, venue: true, participants: { where: { status: "JOINED" } } },
      orderBy: { startAt: "asc" },
      take: 3,
    });
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      startAt: s.startAt.toISOString(),
      sportSlug: s.sport.slug,
      sportName: s.sport.name,
      venueName: s.venue?.name ?? null,
      joinedCount: s.participants.length,
      maxParticipants: s.maxParticipants,
      costPerPerson: s.costPerPerson,
    }));
  },
  ["public:home-sessions:v2"],
  { revalidate: 300, tags: [SESSIONS_TAG] },
);

/* ------------------------------------------------------------------ */
/* Venue list (/venues)                                                */
/* ------------------------------------------------------------------ */

/** Filter set AFTER normalization — this exact shape is the cache key. */
export interface VenueListFilters {
  sport: string | null;
  q: string | null;
  district: string | null;
  maxPrice: number | null;
  minRating: number | null;
  type: string | null;
  beginner: boolean;
  family: boolean;
  sort: string | null;
}

export interface VenueListItem {
  id: string;
  slug: string;
  name: string;
  district: string;
  address: string;
  ratingAvg: number;
  ratingCount: number;
  beginnerFriendly: boolean;
  familyFriendly: boolean;
  minPrice: number | null;
  sports: { slug: string; name: string }[];
  primarySportSlug: string | null;
  /** Stored primary photo (Cloudflare R2), when the venue has one; null → the code map decides. */
  imageUrl: string | null;
}

/** Prisma `where` shared by the venue list and the map dataset — one
 * definition so the two views can never disagree about what a filter set
 * matches. (The maxPrice cap is NOT here: prices live on facilities, so
 * both readers apply it in JS after computing each venue's min price.) */
function venueWhereFromFilters(filters: VenueListFilters): Prisma.VenueWhereInput {
  return {
    status: "APPROVED",
    ...(filters.district ? { district: filters.district } : {}),
    ...(filters.type ? { venueType: filters.type } : {}),
    ...(filters.beginner ? { beginnerFriendly: true } : {}),
    ...(filters.family ? { familyFriendly: true } : {}),
    ...(filters.minRating != null ? { ratingAvg: { gte: filters.minRating } } : {}),
    ...(filters.sport ? { sports: { some: { sport: { slug: filters.sport } } } } : {}),
    ...(filters.q ? { OR: [{ name: { contains: filters.q } }, { district: { contains: filters.q } }, { address: { contains: filters.q } }] } : {}),
  };
}

export const getCachedVenueList = unstable_cache(
  async (filters: VenueListFilters): Promise<VenueListItem[]> => {
    const venues = await prisma.venue.findMany({
      where: venueWhereFromFilters(filters),
      include: {
        sports: { include: { sport: true } },
        facilities: { include: { priceRules: true } },
        images: { orderBy: { sortOrder: "asc" }, select: { url: true } },
      },
    });
    const withPrice = venues.map((v) => ({ v, minPrice: minPriceOf(v.facilities), createdAtMs: v.createdAt.getTime() }));
    const filtered = withPrice.filter((x) => filters.maxPrice == null || (x.minPrice !== null && x.minPrice <= filters.maxPrice));
    const sorted = [...filtered].sort((a, b) => {
      switch (filters.sort) {
        case "price-asc":
          return (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity);
        case "rating":
          return b.v.ratingAvg - a.v.ratingAvg;
        case "newest":
          return b.createdAtMs - a.createdAtMs;
        default:
          return b.v.ratingAvg - a.v.ratingAvg;
      }
    });
    return sorted.map(({ v, minPrice }) => ({
      id: v.id,
      slug: v.slug,
      name: v.name,
      district: v.district,
      address: v.address,
      ratingAvg: v.ratingAvg,
      ratingCount: v.ratingCount,
      beginnerFriendly: v.beginnerFriendly,
      familyFriendly: v.familyFriendly,
      minPrice,
      sports: v.sports.map((s) => ({ slug: s.sport.slug, name: s.sport.name })),
      primarySportSlug: v.sports[0]?.sport.slug ?? null,
      imageUrl: storedPrimaryImageUrl(v.images),
    }));
  },
  ["public:venue-list:v2"],
  { revalidate: 60, tags: [VENUES_TAG] },
);

/* ------------------------------------------------------------------ */
/* Venue map (/venues?view=map)                                        */
/* ------------------------------------------------------------------ */

/** One map pin: the same filter set as the list, projected down to what
 * a marker + popup needs. Venues without coordinates can't be pinned
 * and are excluded here (the list still shows them). */
export interface VenueMapPoint {
  slug: string;
  name: string;
  district: string;
  latitude: number;
  longitude: number;
  primarySportSlug: string | null;
  sportName: string | null;
  minPrice: number | null;
  ratingAvg: number;
  ratingCount: number;
}

export const getCachedVenueMapPoints = unstable_cache(
  async (filters: VenueListFilters): Promise<VenueMapPoint[]> => {
    const venues = await prisma.venue.findMany({
      where: venueWhereFromFilters(filters),
      include: {
        sports: { include: { sport: true } },
        facilities: { include: { priceRules: true } },
      },
    });
    return venues
      .map((v) => ({ v, minPrice: minPriceOf(v.facilities) }))
      .filter((x) => filters.maxPrice == null || (x.minPrice !== null && x.minPrice <= filters.maxPrice))
      .filter((x) => x.v.latitude != null && x.v.longitude != null)
      .map(({ v, minPrice }) => ({
        slug: v.slug,
        name: v.name,
        district: v.district,
        latitude: v.latitude as number,
        longitude: v.longitude as number,
        primarySportSlug: v.sports[0]?.sport.slug ?? null,
        sportName: v.sports[0]?.sport.name ?? null,
        minPrice,
        ratingAvg: v.ratingAvg,
        ratingCount: v.ratingCount,
      }));
  },
  ["public:venue-map-points:v2"],
  { revalidate: 60, tags: [VENUES_TAG] },
);

export const getCachedSportsAndDistricts = unstable_cache(
  async (): Promise<{ sports: { id: string; slug: string; name: string }[]; districts: string[] }> => {
    const sports = await prisma.sport.findMany();
    const districtRows = await prisma.venue.findMany({ select: { district: true } });
    return {
      sports: sports.map((s) => ({ id: s.id, slug: s.slug, name: s.name })),
      districts: [...new Set(districtRows.map((v) => v.district))],
    };
  },
  ["public:sports-districts:v2"],
  { revalidate: 60, tags: [VENUES_TAG] },
);

/* ------------------------------------------------------------------ */
/* Venue detail (/venues/[slug])                                       */
/* ------------------------------------------------------------------ */

export interface VenueDetailData {
  id: string;
  slug: string;
  name: string;
  description: string;
  address: string;
  district: string;
  city: string;
  ratingAvg: number;
  ratingCount: number;
  beginnerFriendly: boolean;
  familyFriendly: boolean;
  instantBooking: boolean;
  latitude: number | null;
  longitude: number | null;
  cancelFullBeforeHours: number;
  cancelPartialBeforeHours: number;
  cancelPartialFeePercent: number;
  /** Stored primary photo (Cloudflare R2), when the venue has one; null → the code map decides. */
  imageUrl: string | null;
  sports: { id: string; slug: string; name: string }[];
  amenities: { id: string; name: string }[];
  facilities: {
    id: string;
    name: string;
    surface: string | null;
    capacity: number;
    sport: { slug: string; name: string };
    priceRules: { id: string; ruleType: string; pricePerHour: number }[];
  }[];
  hours: { dayOfWeek: number; openTime: string; closeTime: string }[];
  reviews: { id: string; rating: number; comment: string; isSeed: boolean; userName: string }[];
  sessions: { id: string; title: string; /** ISO string (cache-safe). */ startAt: string }[];
}

export const getCachedVenueDetail = unstable_cache(
  async (slug: string): Promise<VenueDetailData | null> => {
    const venue = await prisma.venue.findUnique({
      where: { slug },
      include: {
        sports: { include: { sport: true } },
        amenities: true,
        images: { orderBy: { sortOrder: "asc" }, select: { url: true } },
        facilities: { include: { priceRules: true, sport: true } },
        hours: { orderBy: { dayOfWeek: "asc" } },
        reviews: { include: { user: true }, orderBy: { createdAt: "desc" }, take: 10 },
        sessions: { where: { status: { in: ["OPEN", "FULL"] } }, include: { sport: true }, orderBy: { startAt: "asc" }, take: 3 },
      },
    });
    if (!venue || venue.status !== "APPROVED") return null;
    return {
      id: venue.id,
      slug: venue.slug,
      name: venue.name,
      description: venue.description,
      address: venue.address,
      district: venue.district,
      city: venue.city,
      ratingAvg: venue.ratingAvg,
      ratingCount: venue.ratingCount,
      beginnerFriendly: venue.beginnerFriendly,
      familyFriendly: venue.familyFriendly,
      instantBooking: venue.instantBooking,
      latitude: venue.latitude,
      longitude: venue.longitude,
      cancelFullBeforeHours: venue.cancelFullBeforeHours,
      cancelPartialBeforeHours: venue.cancelPartialBeforeHours,
      cancelPartialFeePercent: venue.cancelPartialFeePercent,
      imageUrl: storedPrimaryImageUrl(venue.images),
      sports: venue.sports.map((s) => ({ id: s.id, slug: s.sport.slug, name: s.sport.name })),
      amenities: venue.amenities.map((a) => ({ id: a.id, name: a.name })),
      facilities: venue.facilities.map((f) => ({
        id: f.id,
        name: f.name,
        surface: f.surface,
        capacity: f.capacity,
        sport: { slug: f.sport.slug, name: f.sport.name },
        priceRules: f.priceRules.map((r) => ({ id: r.id, ruleType: r.ruleType, pricePerHour: r.pricePerHour })),
      })),
      hours: venue.hours.map((h) => ({ dayOfWeek: h.dayOfWeek, openTime: h.openTime, closeTime: h.closeTime })),
      reviews: venue.reviews.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, isSeed: r.isSeed, userName: r.user.name })),
      sessions: venue.sessions.map((s) => ({ id: s.id, title: s.title, startAt: s.startAt.toISOString() })),
    };
  },
  ["public:venue-detail:v2"],
  { revalidate: 300, tags: [VENUES_TAG] },
);
