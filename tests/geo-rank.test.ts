import { describe, expect, it } from "vitest";
import { formatDistance, haversineKm, rankVenues, type RankableVenue } from "@/lib/geo/rank";

// Seed coordinates (prisma/seed.ts) — the same points the E2E spec uses.
const THU_DUC = { lat: 10.8503, lng: 106.7553 }; // Smash Arena Thủ Đức
const QUAN_1 = { lat: 10.782, lng: 106.706 }; // Riverside Tennis Quận 1

function venue(partial: Partial<RankableVenue> & { ratingAvg: number }): RankableVenue {
  return { minPrice: 120000, latitude: null, longitude: null, ...partial };
}

describe("haversineKm", () => {
  it("is zero for identical points and symmetric", () => {
    expect(haversineKm(THU_DUC.lat, THU_DUC.lng, THU_DUC.lat, THU_DUC.lng)).toBe(0);
    const ab = haversineKm(THU_DUC.lat, THU_DUC.lng, QUAN_1.lat, QUAN_1.lng);
    const ba = haversineKm(QUAN_1.lat, QUAN_1.lng, THU_DUC.lat, THU_DUC.lng);
    expect(ab).toBeCloseTo(ba, 10);
  });

  it("Thủ Đức ↔ Quận 1 falls in the sane ~7–12 km straight-line band", () => {
    const d = haversineKm(THU_DUC.lat, THU_DUC.lng, QUAN_1.lat, QUAN_1.lng);
    expect(d).toBeGreaterThan(7);
    expect(d).toBeLessThan(12);
  });
});

describe("rankVenues", () => {
  const user = { lat: 10.85, lng: 106.755 }; // Thủ Đức, next to Smash Arena

  it("higher rating wins even when farther away", () => {
    const near = venue({ ratingAvg: 4.5, latitude: 10.858, longitude: 106.747 }); // ~1,2 km
    const far = venue({ ratingAvg: 4.9, latitude: 10.725, longitude: 106.728 }); // ~14 km
    const ranked = rankVenues([near, far], user);
    expect(ranked[0].ratingAvg).toBe(4.9);
    expect(ranked[0].distanceKm).toBeGreaterThan(10);
    expect(ranked[1].distanceKm).toBeLessThan(2);
  });

  it("equal rating → nearer venue wins", () => {
    const far = venue({ ratingAvg: 4.6, latitude: 10.725, longitude: 106.728 }); // Aqua, ~14,2 km
    const near = venue({ ratingAvg: 4.6, latitude: 10.738, longitude: 106.713 }); // Football Q7, ~13,3 km
    const ranked = rankVenues([far, near], user);
    expect(ranked[0].latitude).toBe(10.738);
    expect(ranked[0].distanceKm).toBeLessThan(ranked[1].distanceKm!);
  });

  it("equal rating + equal distance → cheaper venue wins", () => {
    const pricey = venue({ ratingAvg: 4.6, minPrice: 200000, latitude: 10.8, longitude: 106.71 });
    const cheap = venue({ ratingAvg: 4.6, minPrice: 100000, latitude: 10.8, longitude: 106.71 });
    const ranked = rankVenues([pricey, cheap], user);
    expect(ranked[0].minPrice).toBe(100000);
    expect(ranked[0].distanceKm).toBeCloseTo(ranked[1].distanceKm!, 10);
  });

  it("null user position → ranks by rating, then price; distances stay null", () => {
    const a = venue({ ratingAvg: 4.6, minPrice: 200000, latitude: 10.8, longitude: 106.71 });
    const b = venue({ ratingAvg: 4.6, minPrice: 100000, latitude: 10.9, longitude: 106.8 });
    const c = venue({ ratingAvg: 4.9, minPrice: 500000, latitude: 10.7, longitude: 106.7 });
    const ranked = rankVenues([a, b, c], null);
    expect(ranked.map((v) => v.minPrice)).toEqual([500000, 100000, 200000]);
    expect(ranked.every((v) => v.distanceKm === null)).toBe(true);
  });

  it("venue without coordinates sorts after same-rated venues with coordinates", () => {
    const noCoords = venue({ ratingAvg: 4.6, minPrice: 50000, latitude: null, longitude: null });
    const far = venue({ ratingAvg: 4.6, minPrice: 300000, latitude: 10.725, longitude: 106.728 });
    const ranked = rankVenues([noCoords, far], user);
    expect(ranked[0].latitude).toBe(10.725); // known distance beats unknown, despite higher price
    expect(ranked[1].distanceKm).toBeNull();
  });

  it("venue with only one coordinate set is treated as unknown distance", () => {
    const half = venue({ ratingAvg: 4.6, latitude: 10.8, longitude: null });
    const ranked = rankVenues([half], user);
    expect(ranked[0].distanceKm).toBeNull();
  });

  it("does not mutate the input array or its items", () => {
    const a = venue({ ratingAvg: 4.5, latitude: 10.8, longitude: 106.71 });
    const b = venue({ ratingAvg: 4.9, latitude: 10.9, longitude: 106.8 });
    const input = [a, b];
    const snapshot = JSON.stringify(input);
    const ranked = rankVenues(input, user);
    expect(input[0]).toBe(a); // original order untouched
    expect(input[1]).toBe(b);
    expect(JSON.stringify(input)).toBe(snapshot); // no distanceKm leaked onto inputs
    expect(ranked[0]).not.toBe(b); // results are copies
  });
});

describe("formatDistance", () => {
  it("formats sub-kilometre distances as whole metres", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(0.047)).toBe("47 m");
    expect(formatDistance(0.85)).toBe("850 m");
    expect(formatDistance(0.9994)).toBe("999 m");
  });

  it("formats 1–10 km with one decimal and a comma separator", () => {
    expect(formatDistance(1.247)).toBe("1,2 km");
    expect(formatDistance(2.3)).toBe("2,3 km");
    expect(formatDistance(9.264)).toBe("9,3 km");
  });

  it("formats 10+ km as whole kilometres", () => {
    expect(formatDistance(13.272)).toBe("13 km");
    expect(formatDistance(14.209)).toBe("14 km");
  });
});
