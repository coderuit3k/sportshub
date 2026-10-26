import { describe, expect, it, vi } from "vitest";

/**
 * Venue map dataset (`getCachedVenueMapPoints`) — the pins behind
 * /venues?view=map. Prisma is mocked with a fake that EMULATES the
 * where-clause the shared filter builder produces, so these tests cover
 * real behavior: every list filter narrows the pins, venues without
 * coordinates are excluded, and the maxPrice cap (applied in JS, like
 * the list) drops both too-expensive and unpriced venues.
 * `unstable_cache` is stubbed to the identity so the cached wrapper
 * runs the underlying query function directly.
 */

interface FakeVenue {
  slug: string;
  name: string;
  district: string;
  address: string;
  status: string;
  venueType: string;
  beginnerFriendly: boolean;
  familyFriendly: boolean;
  ratingAvg: number;
  ratingCount: number;
  latitude: number | null;
  longitude: number | null;
  sports: Array<{ sport: { slug: string; name: string } }>;
  facilities: Array<{ priceRules: Array<{ pricePerHour: number }> }>;
}

const VENUES: FakeVenue[] = [
  {
    slug: "alpha", name: "Alpha Badminton", district: "Quận 1", address: "1 Alpha St",
    status: "APPROVED", venueType: "INDOOR", beginnerFriendly: true, familyFriendly: false,
    ratingAvg: 4.8, ratingCount: 120, latitude: 10.77, longitude: 106.7,
    sports: [{ sport: { slug: "cau-long", name: "Cầu lông" } }],
    facilities: [{ priceRules: [{ pricePerHour: 150000 }, { pricePerHour: 100000 }] }],
  },
  {
    slug: "beta", name: "Beta Football", district: "Quận 7", address: "7 Beta St",
    status: "APPROVED", venueType: "OUTDOOR", beginnerFriendly: false, familyFriendly: true,
    ratingAvg: 4.2, ratingCount: 40, latitude: 10.73, longitude: 106.72,
    sports: [{ sport: { slug: "bong-da-mini", name: "Bóng đá mini" } }],
    facilities: [{ priceRules: [{ pricePerHour: 200000 }] }],
  },
  {
    slug: "no-coords", name: "No Coords Club", district: "Quận 1", address: "9 Nowhere St",
    status: "APPROVED", venueType: "INDOOR", beginnerFriendly: true, familyFriendly: true,
    ratingAvg: 4.9, ratingCount: 10, latitude: null, longitude: null,
    sports: [{ sport: { slug: "cau-long", name: "Cầu lông" } }],
    facilities: [{ priceRules: [{ pricePerHour: 80000 }] }],
  },
  {
    slug: "pending", name: "Pending Place", district: "Quận 1", address: "3 Pending St",
    status: "PENDING", venueType: "INDOOR", beginnerFriendly: true, familyFriendly: true,
    ratingAvg: 5.0, ratingCount: 1, latitude: 10.78, longitude: 106.71,
    sports: [{ sport: { slug: "cau-long", name: "Cầu lông" } }],
    facilities: [{ priceRules: [{ pricePerHour: 50000 }] }],
  },
  {
    slug: "no-price", name: "No Price Courts", district: "Quận 3", address: "5 Free St",
    status: "APPROVED", venueType: "MIXED", beginnerFriendly: false, familyFriendly: false,
    ratingAvg: 4.0, ratingCount: 3, latitude: 10.78, longitude: 106.69,
    sports: [{ sport: { slug: "quan-vot", name: "Quần vợt" } }],
    facilities: [],
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchesWhere(v: FakeVenue, where: any): boolean {
  if (where.status && v.status !== where.status) return false;
  if (where.district && v.district !== where.district) return false;
  if (where.venueType && v.venueType !== where.venueType) return false;
  if (where.beginnerFriendly === true && !v.beginnerFriendly) return false;
  if (where.familyFriendly === true && !v.familyFriendly) return false;
  if (where.ratingAvg?.gte != null && v.ratingAvg < where.ratingAvg.gte) return false;
  const sportSlug = where.sports?.some?.sport?.slug;
  if (sportSlug && !v.sports.some((s) => s.sport.slug === sportSlug)) return false;
  if (where.OR) {
    const q = String(where.OR[0].name.contains).toLowerCase();
    if (![v.name, v.district, v.address].some((f) => f.toLowerCase().includes(q))) return false;
  }
  return true;
}

vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    venue: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: vi.fn(async ({ where }: { where: any }) => VENUES.filter((v) => matchesWhere(v, where))),
    },
  },
}));

import { getCachedVenueMapPoints, type VenueListFilters } from "@/lib/public-data";

const NO_FILTERS: VenueListFilters = {
  sport: null, q: null, district: null, maxPrice: null, minRating: null,
  type: null, beginner: false, family: false, sort: null,
};
const filters = (patch: Partial<VenueListFilters>): VenueListFilters => ({ ...NO_FILTERS, ...patch });
const slugs = (points: { slug: string }[]) => points.map((p) => p.slug).sort();

describe("getCachedVenueMapPoints", () => {
  it("returns every approved venue with coordinates when unfiltered", async () => {
    const points = await getCachedVenueMapPoints(NO_FILTERS);
    expect(slugs(points)).toEqual(["alpha", "beta", "no-price"]);
  });

  it("projects the popup DTO: sport, district, min price, rating", async () => {
    const [alpha] = await getCachedVenueMapPoints(filters({ district: "Quận 1" }));
    expect(alpha).toEqual({
      slug: "alpha",
      name: "Alpha Badminton",
      district: "Quận 1",
      latitude: 10.77,
      longitude: 106.7,
      primarySportSlug: "cau-long",
      sportName: "Cầu lông",
      minPrice: 100000,
      ratingAvg: 4.8,
      ratingCount: 120,
    });
  });

  it("excludes venues without coordinates even when they match the filters", async () => {
    const points = await getCachedVenueMapPoints(filters({ district: "Quận 1", sport: "cau-long" }));
    expect(slugs(points)).toEqual(["alpha"]); // no-coords + pending stay out
  });

  it("applies the district filter", async () => {
    expect(slugs(await getCachedVenueMapPoints(filters({ district: "Quận 7" })))).toEqual(["beta"]);
  });

  it("applies the sport filter", async () => {
    expect(slugs(await getCachedVenueMapPoints(filters({ sport: "bong-da-mini" })))).toEqual(["beta"]);
  });

  it("applies the keyword filter across name/district/address", async () => {
    expect(slugs(await getCachedVenueMapPoints(filters({ q: "beta" })))).toEqual(["beta"]);
    expect(slugs(await getCachedVenueMapPoints(filters({ q: "quận 3" })))).toEqual(["no-price"]);
  });

  it("applies type, beginner, family and minRating filters", async () => {
    expect(slugs(await getCachedVenueMapPoints(filters({ type: "OUTDOOR" })))).toEqual(["beta"]);
    expect(slugs(await getCachedVenueMapPoints(filters({ beginner: true })))).toEqual(["alpha"]);
    expect(slugs(await getCachedVenueMapPoints(filters({ family: true })))).toEqual(["beta"]);
    expect(slugs(await getCachedVenueMapPoints(filters({ minRating: 4.5 })))).toEqual(["alpha"]);
  });

  it("applies the maxPrice cap in JS: over-cap and unpriced venues drop out", async () => {
    expect(slugs(await getCachedVenueMapPoints(filters({ maxPrice: 150000 })))).toEqual(["alpha"]);
    // Without a cap the unpriced venue is present and reports a null price.
    const uncapped = await getCachedVenueMapPoints(NO_FILTERS);
    expect(uncapped.find((p) => p.slug === "no-price")?.minPrice).toBeNull();
  });
});
