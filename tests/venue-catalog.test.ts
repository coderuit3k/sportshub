import { describe, expect, it } from "vitest";
import {
  CATALOG_PER_SPORT,
  CATALOG_VENUES,
  FLAGSHIP_VENUE_SLUGS,
  KNOWN_AMENITIES,
  SPORT_DEFS,
  SPORT_PRICE_RANGES,
  generateCatalog,
  type SportSlug,
} from "../prisma/venue-catalog";

/**
 * Guards for the generated venue catalog (prisma/venue-catalog.ts):
 * 29 generated venues per sport + the 1 hand-written flagship in
 * prisma/seed.ts = exactly 30 APPROVED venues per sport.
 */

/** Flagship venues from prisma/seed.ts: slug → primary sport + name. */
const FLAGSHIPS: Record<string, { sport: SportSlug; name: string }> = {
  "smash-arena-thu-duc": { sport: "cau-long", name: "CLB Cầu Lông Smash Arena Thủ Đức" },
  "pickle-hub-binh-thanh": { sport: "pickleball", name: "PickleHub Bình Thạnh" },
  "sai-gon-mini-football-q7": { sport: "bong-da-mini", name: "Sân Bóng Mini Sài Gòn Quận 7" },
  "riverside-tennis-q1": { sport: "quan-vot", name: "Riverside Tennis Quận 1" },
  "hoops-center-thu-duc": { sport: "bong-ro", name: "Hoops Center Thủ Đức" },
  "aqua-pool-q7": { sport: "boi-loi", name: "Aqua Pool Quận 7" },
};

const FACILITY_COUNT_RANGES: Record<SportSlug, [number, number]> = {
  "cau-long": [4, 10],
  pickleball: [3, 8],
  "bong-da-mini": [2, 4],
  "quan-vot": [2, 6],
  "bong-ro": [1, 3],
  "boi-loi": [1, 1],
};

describe("venue catalog", () => {
  it("generates exactly 29 venues per sport — 30 per sport including the flagship", () => {
    expect(CATALOG_VENUES).toHaveLength(CATALOG_PER_SPORT * SPORT_DEFS.length);
    for (const sport of SPORT_DEFS) {
      const generated = CATALOG_VENUES.filter((v) => v.primarySportSlug === sport.slug);
      expect(generated, sport.slug).toHaveLength(CATALOG_PER_SPORT);
      const flagship = Object.values(FLAGSHIPS).filter((f) => f.sport === sport.slug);
      expect(flagship, sport.slug).toHaveLength(1);
      expect(generated.length + flagship.length, sport.slug).toBe(30);
    }
  });

  it("keeps the flagship registry in sync with the seed", () => {
    expect([...FLAGSHIP_VENUE_SLUGS].sort()).toEqual(Object.keys(FLAGSHIPS).sort());
  });

  it("has unique slugs and names, also against the flagships", () => {
    const slugs = [...CATALOG_VENUES.map((v) => v.slug), ...Object.keys(FLAGSHIPS)];
    expect(new Set(slugs).size).toBe(slugs.length);
    const names = [...CATALOG_VENUES.map((v) => v.name), ...Object.values(FLAGSHIPS).map((f) => f.name)];
    expect(new Set(names).size).toBe(names.length);
  });

  it("places every venue inside the HCMC bounding box", () => {
    for (const v of CATALOG_VENUES) {
      expect(v.latitude, v.slug).toBeGreaterThanOrEqual(10.35);
      expect(v.latitude, v.slug).toBeLessThanOrEqual(10.98);
      expect(v.longitude, v.slug).toBeGreaterThanOrEqual(106.35);
      expect(v.longitude, v.slug).toBeLessThanOrEqual(106.98);
    }
  });

  it("covers all 22 HCMC districts", () => {
    expect(new Set(CATALOG_VENUES.map((v) => v.district)).size).toBe(22);
  });

  it("keeps every price rule inside the per-sport hourly band", () => {
    for (const v of CATALOG_VENUES) {
      const [min, max] = SPORT_PRICE_RANGES[v.primarySportSlug];
      for (const f of v.facilities) {
        expect(f.priceRules.map((r) => r.ruleType).sort()).toEqual(["OFF_PEAK", "PEAK", "WEEKEND"]);
        for (const r of f.priceRules) {
          expect(r.pricePerHour, `${v.slug}/${f.name}`).toBeGreaterThanOrEqual(min);
          expect(r.pricePerHour, `${v.slug}/${f.name}`).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it("gives every venue at least one facility, within the per-sport count range", () => {
    for (const v of CATALOG_VENUES) {
      const [min, max] = FACILITY_COUNT_RANGES[v.primarySportSlug];
      expect(v.facilities.length, v.slug).toBeGreaterThanOrEqual(Math.max(1, min));
      expect(v.facilities.length, v.slug).toBeLessThanOrEqual(max);
    }
  });

  it("uses only known amenities, 2–5 per venue", () => {
    for (const v of CATALOG_VENUES) {
      expect(v.amenities.length, v.slug).toBeGreaterThanOrEqual(2);
      expect(v.amenities.length, v.slug).toBeLessThanOrEqual(KNOWN_AMENITIES.length);
      for (const a of v.amenities) expect(KNOWN_AMENITIES, v.slug).toContain(a);
    }
  });

  it("keeps ratings in 3.9–4.9 (one decimal), counts in 12–480, and at most five 4.9★ venues", () => {
    let top = 0;
    for (const v of CATALOG_VENUES) {
      expect(v.ratingAvg, v.slug).toBeGreaterThanOrEqual(3.9);
      expect(v.ratingAvg, v.slug).toBeLessThanOrEqual(4.9);
      expect(Number(v.ratingAvg.toFixed(1))).toBe(v.ratingAvg);
      expect(v.ratingCount, v.slug).toBeGreaterThanOrEqual(12);
      expect(v.ratingCount, v.slug).toBeLessThanOrEqual(480);
      if (v.ratingAvg >= 4.9) top += 1;
    }
    // The flagship Smash Arena (4.9★) must keep a homepage featured
    // slot (top 6 by rating) no matter how ties break.
    expect(top).toBeLessThanOrEqual(5);
  });

  it("is deterministic: two generator runs are identical", () => {
    const a = generateCatalog();
    const b = generateCatalog();
    expect(a).toEqual(b);
    expect(CATALOG_VENUES).toEqual(a);
  });

  it("contains no demo wording anywhere in the generated copy", () => {
    for (const v of CATALOG_VENUES) {
      const text = `${v.name} ${v.description} ${v.address}`;
      expect(text.toLowerCase(), v.slug).not.toContain("demo");
    }
  });
});
