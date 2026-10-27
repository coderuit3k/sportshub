import { describe, expect, it, vi } from "vitest";

/**
 * /venues minRating filter — it must match the EFFECTIVE rating
 * (googleRating ?? ratingAvg). Real (Google) venues store their
 * aggregate on googleRating / googleRatingCount and keep the in-app
 * ratingAvg at 0, so a filter on ratingAvg alone (the pre-swap
 * behaviour) matched nothing for them. Prisma is mocked with a fake
 * whose matcher evaluates the where clause GENERICALLY (recursive
 * AND/OR, equality, null checks, gte), so the tests pin the semantics
 * of whatever condition the builder emits rather than its exact shape.
 * `unstable_cache` is stubbed to the identity, mirroring
 * venue-map-points.test.ts.
 */

interface FakeVenue {
  id: string;
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
  googleRating: number | null;
  googleRatingCount: number | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: Date;
  sports: Array<{ sport: { slug: string; name: string } }>;
  facilities: Array<{ priceRules: Array<{ pricePerHour: number }> }>;
  images: Array<{ url: string }>;
}

const base = {
  district: "Quận 1",
  address: "1 Test St",
  status: "APPROVED",
  venueType: "INDOOR",
  beginnerFriendly: false,
  familyFriendly: false,
  latitude: 10.77,
  longitude: 106.7,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  sports: [{ sport: { slug: "cau-long", name: "Cầu lông" } }],
  facilities: [{ priceRules: [{ pricePerHour: 100000 }] }],
  images: [],
};

const VENUES: FakeVenue[] = [
  {
    ...base, id: "v-google-high", slug: "google-high", name: "Google High",
    ratingAvg: 0, ratingCount: 0, googleRating: 4.8, googleRatingCount: 900,
  },
  {
    ...base, id: "v-google-low", slug: "google-low", name: "Google Low",
    ratingAvg: 0, ratingCount: 0, googleRating: 4.1, googleRatingCount: 35,
  },
  {
    ...base, id: "v-inapp-high", slug: "inapp-high", name: "In-App High",
    ratingAvg: 4.7, ratingCount: 120, googleRating: null, googleRatingCount: null,
  },
  {
    ...base, id: "v-inapp-low", slug: "inapp-low", name: "In-App Low",
    ratingAvg: 3.9, ratingCount: 12, googleRating: null, googleRatingCount: null,
  },
  {
    // Both aggregates present: the Google one IS the effective rating.
    ...base, id: "v-google-wins", slug: "google-wins", name: "Google Wins",
    ratingAvg: 4.9, ratingCount: 300, googleRating: 4.2, googleRatingCount: 1500,
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchesWhere(v: FakeVenue, where: any): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Object.entries(where).every(([key, cond]: [string, any]) => {
    if (key === "AND") return (cond as unknown[]).every((c) => matchesWhere(v, c));
    if (key === "OR") return (cond as unknown[]).some((c) => matchesWhere(v, c));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (v as any)[key];
    if (cond === null) return value == null;
    if (typeof cond === "object") {
      if ("gte" in cond) return value != null && value >= cond.gte;
      throw new Error(`fake matcher: unsupported condition for ${key}: ${JSON.stringify(cond)}`);
    }
    return value === cond;
  });
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

import { getCachedVenueList, type VenueListFilters } from "@/lib/public-data";

const NO_FILTERS: VenueListFilters = {
  sport: null, q: null, district: null, maxPrice: null, minRating: null,
  type: null, beginner: false, family: false, sort: null,
};
const filters = (patch: Partial<VenueListFilters>): VenueListFilters => ({ ...NO_FILTERS, ...patch });
const slugs = (items: { slug: string }[]) => items.map((i) => i.slug).sort();

describe("venue list minRating filter (effective rating)", () => {
  it("returns every venue when minRating is unset", async () => {
    expect(slugs(await getCachedVenueList(NO_FILTERS))).toEqual([
      "google-high", "google-low", "google-wins", "inapp-high", "inapp-low",
    ]);
  });

  it("matches a google-only venue (ratingAvg 0) by its Google rating", async () => {
    const items = await getCachedVenueList(filters({ minRating: 4.5 }));
    expect(slugs(items)).toEqual(["google-high", "inapp-high"]);
    const googleHigh = items.find((i) => i.slug === "google-high");
    expect(googleHigh?.ratingAvg).toBe(0); // the in-app aggregate really is 0…
    expect(googleHigh?.googleRating).toBe(4.8); // …and the Google one carried the match
  });

  it("keeps the pre-swap behaviour for venues without a Google rating", async () => {
    expect(slugs(await getCachedVenueList(filters({ minRating: 4.0 })))).toEqual([
      "google-high", "google-low", "google-wins", "inapp-high",
    ]);
    expect(slugs(await getCachedVenueList(filters({ minRating: 4.7 })))).toEqual([
      "google-high", "inapp-high",
    ]);
  });

  it("lets the Google rating win when both aggregates exist (googleRating ?? ratingAvg)", async () => {
    // google-wins has ratingAvg 4.9 but googleRating 4.2: at 4.5 it must NOT match.
    expect(slugs(await getCachedVenueList(filters({ minRating: 4.5 })))).not.toContain("google-wins");
    expect(slugs(await getCachedVenueList(filters({ minRating: 4.2 })))).toContain("google-wins");
  });
});
