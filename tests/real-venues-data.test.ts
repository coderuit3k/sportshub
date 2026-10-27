import { describe, expect, it } from "vitest";
import {
  RAW_REAL_VENUE_ENTRIES,
  REAL_VENUES,
  buildRealVenues,
  localitySegmentFromAddress,
  normalizeOpenHours,
  parseDistrictFromAddress,
  resolveDistrict,
  type RawRealVenueEntry,
} from "../prisma/real-venues-data";
import { buildSportPriceRules } from "../prisma/real-catalog";
import { SPORT_PRICE_RANGES, type SportSlug } from "../prisma/venue-catalog";
import { slugify } from "../prisma/venue-catalog";

/**
 * The real-venue data module: 120 harvested listings (20/sport) merged
 * into 119 unique venues, deterministic slugs, district parsing and
 * Google-hours normalization. All pure — no database involved.
 */

function raw(partial: Partial<RawRealVenueEntry> & { name: string }): RawRealVenueEntry {
  return {
    sportSlug: "cau-long",
    address: "1 Đường A, Phường X, Hồ Chí Minh, Việt Nam",
    district: "",
    latitude: 10.8,
    longitude: 106.7,
    rating: 4.5,
    ratingCount: 100,
    openHours: null,
    ...partial,
  };
}

describe("harvest data integrity", () => {
  it("holds 120 raw listings, 20 per sport", () => {
    expect(RAW_REAL_VENUE_ENTRIES).toHaveLength(120);
    for (const slug of Object.keys(SPORT_PRICE_RANGES) as SportSlug[]) {
      expect(RAW_REAL_VENUE_ENTRIES.filter((e) => e.sportSlug === slug)).toHaveLength(20);
    }
  });

  it("merges to exactly 119 unique venues with unique slugs", () => {
    expect(REAL_VENUES).toHaveLength(119);
    expect(new Set(REAL_VENUES.map((v) => v.slug)).size).toBe(119);
    // Every venue appears under each of its sports: 120 sport links total.
    expect(REAL_VENUES.reduce((n, v) => n + v.sportSlugs.length, 0)).toBe(120);
    for (const slug of Object.keys(SPORT_PRICE_RANGES) as SportSlug[]) {
      expect(REAL_VENUES.filter((v) => v.sportSlugs.includes(slug))).toHaveLength(20);
    }
  });

  it("every merged venue keeps its harvested Google aggregate and coordinates", () => {
    for (const v of REAL_VENUES) {
      expect(v.googleRating).toBeGreaterThan(0);
      expect(v.googleRating).toBeLessThanOrEqual(5);
      expect(v.googleRatingCount).toBeGreaterThan(0);
      expect(v.latitude).toBeGreaterThan(10.3);
      expect(v.latitude).toBeLessThan(11.1);
      expect(v.longitude).toBeGreaterThan(106.3);
      expect(v.longitude).toBeLessThan(107.1);
      expect(v.slug).toBe(slugify(v.slug)); // already kebab-normalized
    }
  });
});

describe("buildRealVenues merging", () => {
  it("merges the same business listed under two sports (name + coords at 4dp)", () => {
    const merged = buildRealVenues([
      raw({ name: "PooC Cầu Lông & PickleBall", sportSlug: "pickleball", latitude: 10.80020481, longitude: 106.66959141 }),
      raw({ name: "PooC Cầu Lông & PickleBall", sportSlug: "cau-long", latitude: 10.80020484, longitude: 106.66959144 }),
    ]);
    expect(merged).toHaveLength(1);
    // Sports come out in SPORT_DEFS order regardless of raw order.
    expect(merged[0].sportSlugs).toEqual(["cau-long", "pickleball"]);
    expect(merged[0].slug).toBe("pooc-cau-long-pickleball");
  });

  it("the real PooC harvest merges into one two-sport venue", () => {
    const pooc = REAL_VENUES.filter((v) => v.name === "PooC Cầu Lông & PickleBall");
    expect(pooc).toHaveLength(1);
    expect(pooc[0].sportSlugs).toEqual(["cau-long", "pickleball"]);
    expect(pooc[0].googleRating).toBe(4.8);
    expect(pooc[0].googleRatingCount).toBe(1449);
  });

  it("does NOT merge same-named venues at different coordinates", () => {
    const merged = buildRealVenues([
      raw({ name: "Sân Bóng Rổ", latitude: 10.7942826, longitude: 106.6538304, address: "QMV3+PG8, Tân Sơn Nhất, Hồ Chí Minh, Việt Nam" }),
      raw({ name: "Sân bóng rổ", latitude: 10.7677972, longitude: 106.6581484, address: "219 Đ. Lý Thường Kiệt, Phú Thọ, Hồ Chí Minh, Việt Nam" }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((v) => v.slug)).toEqual(["san-bong-ro", "san-bong-ro-phu-tho"]);
  });

  it("does NOT merge different businesses that merely share coordinates", () => {
    const merged = buildRealVenues([
      raw({ name: "Sân Cầu Lông A", latitude: 10.8, longitude: 106.7 }),
      raw({ name: "Sân Tennis B", sportSlug: "quan-vot", latitude: 10.8, longitude: 106.7 }),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("slug assignment", () => {
  it("slugifies Vietnamese names (diacritics stripped, đ → d)", () => {
    const [v] = buildRealVenues([raw({ name: "Sân Cầu Lông Đông Hồ" })]);
    expect(v.slug).toBe("san-cau-long-dong-ho");
  });

  it("suffixes a colliding slug with the locality token", () => {
    const merged = buildRealVenues([
      raw({ name: "Sân bóng đá mini", sportSlug: "bong-da-mini", latitude: 10.754156, longitude: 106.6234098, address: "QJ3F+M97, An Lạc, Hồ Chí Minh, Việt Nam" }),
      raw({ name: "Sân bóng đá mini", sportSlug: "bong-da-mini", latitude: 10.7232081, longitude: 106.722039, address: "PPFC+7RM, Khu đô thị Phú Mỹ Hưng, Tân Mỹ, Hồ Chí Minh, Việt Nam" }),
    ]);
    expect(merged.map((v) => v.slug)).toEqual(["san-bong-da-mini", "san-bong-da-mini-tan-my"]);
  });

  it("falls back to a numeric suffix when name and locality both collide", () => {
    const merged = buildRealVenues([
      raw({ name: "Sân X", latitude: 10.1, longitude: 106.1 }),
      raw({ name: "Sân X", latitude: 10.2, longitude: 106.2 }),
      raw({ name: "Sân X", latitude: 10.3, longitude: 106.3 }),
    ]);
    expect(merged.map((v) => v.slug)).toEqual(["san-x", "san-x-phuong-x", "san-x-phuong-x-2"]);
  });
});

describe("parseDistrictFromAddress", () => {
  it("extracts an explicit Quận N", () => {
    expect(parseDistrictFromAddress("219 Đ. Lý Thường Kiệt, Quận 11, Hồ Chí Minh 70000, Việt Nam")).toBe("Quận 11");
    expect(parseDistrictFromAddress("7 Đ. Số 23, Quận 7, Hồ Chí Minh 700000, Việt Nam")).toBe("Quận 7");
  });

  it("recognises named districts written without 'Quận'", () => {
    expect(parseDistrictFromAddress("56 Đ. Hoàng Diệu 2, Thủ Đức, Hồ Chí Minh, Việt Nam")).toBe("Thủ Đức");
    expect(parseDistrictFromAddress("262/1 Quang Trung, Gò Vấp, Hồ Chí Minh, Việt Nam")).toBe("Gò Vấp");
    expect(parseDistrictFromAddress("PPF3+RMG, Nhà Bè, Hồ Chí Minh, Việt Nam")).toBe("Nhà Bè");
    expect(parseDistrictFromAddress("354/47/72 QL1A, Bình Tân, Hồ Chí Minh, Việt Nam")).toBe("Bình Tân");
  });

  it("falls back to the locality segment before 'Hồ Chí Minh'", () => {
    expect(parseDistrictFromAddress("37 Đông Hồ, Tân Hòa, Hồ Chí Minh, Việt Nam")).toBe("Tân Hòa");
    expect(parseDistrictFromAddress("202B Đ. Hoàng Văn Thụ, Đức Nhuận, Hồ Chí Minh 700000, Việt Nam")).toBe("Đức Nhuận");
    expect(parseDistrictFromAddress("QMV3+PG8, Tân Sơn Nhất, Hồ Chí Minh, Việt Nam")).toBe("Tân Sơn Nhất");
  });

  it("rejects street-like segments and address-less strings", () => {
    expect(parseDistrictFromAddress("308 Bình Quới, Hồ Chí Minh, Việt Nam")).toBe("");
    expect(parseDistrictFromAddress("118/29/15/6 Phú Định, Hồ Chí Minh, Việt Nam")).toBe("");
    expect(parseDistrictFromAddress("40 Đ. Kỳ Đồng")).toBe("");
    expect(parseDistrictFromAddress("Unnamed")).toBe("");
  });

  it("resolveDistrict falls back to the harvest-time district", () => {
    expect(resolveDistrict("87 Chế Lan Viên", "Tân Phú")).toBe("Tân Phú");
    expect(resolveDistrict("202B Đ. Hoàng Văn Thụ", "Phú Nhuận")).toBe("Phú Nhuận");
    expect(resolveDistrict("1 A, Thủ Đức, Hồ Chí Minh, Việt Nam", "Gò Vấp")).toBe("Thủ Đức");
    expect(resolveDistrict("40 Đ. Kỳ Đồng", "")).toBe("");
  });

  it("localitySegmentFromAddress is exported and consistent with the district fallback", () => {
    expect(localitySegmentFromAddress("37 Đông Hồ, Tân Hòa, Hồ Chí Minh, Việt Nam")).toBe("Tân Hòa");
    expect(localitySegmentFromAddress("40 Đ. Kỳ Đồng")).toBe("");
  });
});

describe("normalizeOpenHours", () => {
  it("full range strings → those times (all week)", () => {
    expect(normalizeOpenHours("06:00–23:00 hằng ngày")).toEqual({ openTime: "06:00", closeTime: "23:00" });
    expect(normalizeOpenHours("07:00–19:00 hàng ngày")).toEqual({ openTime: "07:00", closeTime: "19:00" });
    expect(normalizeOpenHours("05:00–00:00 hằng ngày")).toEqual({ openTime: "05:00", closeTime: "00:00" });
  });

  it("weekly strings → the first range", () => {
    expect(normalizeOpenHours("Thứ Ba–Chủ Nhật: 05:30–10:00, 13:30–19:00; Thứ Hai: Đóng cửa")).toEqual({
      openTime: "05:30",
      closeTime: "10:00",
    });
  });

  it("closing-time-only status strings → open 05:00, that close (zero-padded)", () => {
    expect(normalizeOpenHours("Đóng cửa vào 23:00")).toEqual({ openTime: "05:00", closeTime: "23:00" });
    expect(normalizeOpenHours("Đóng cửa vào 0:00")).toEqual({ openTime: "05:00", closeTime: "00:00" });
    expect(normalizeOpenHours("Đóng cửa vào 2:00")).toEqual({ openTime: "05:00", closeTime: "02:00" });
    expect(normalizeOpenHours("Đóng cửa vào 22:30")).toEqual({ openTime: "05:00", closeTime: "22:30" });
  });

  it("'open all day' strings → 05:00–23:00", () => {
    expect(normalizeOpenHours("Mở cả ngày")).toEqual({ openTime: "05:00", closeTime: "23:00" });
    expect(normalizeOpenHours("Mở cửa cả ngày")).toEqual({ openTime: "05:00", closeTime: "23:00" });
  });

  it("null / status-only / split-shift strings → the 06:00–22:00 default", () => {
    expect(normalizeOpenHours(null)).toEqual({ openTime: "06:00", closeTime: "22:00" });
    expect(normalizeOpenHours("Đang mở cửa")).toEqual({ openTime: "06:00", closeTime: "22:00" });
    expect(normalizeOpenHours("Đóng cửa 11:30 · Mở cửa lại 13:30")).toEqual({ openTime: "06:00", closeTime: "22:00" });
    expect(normalizeOpenHours("Mở cửa lúc 14:00")).toEqual({ openTime: "06:00", closeTime: "22:00" });
  });

  it("every harvested string normalizes to a valid HH:MM pair", () => {
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const e of RAW_REAL_VENUE_ENTRIES) {
      const { openTime, closeTime } = normalizeOpenHours(e.openHours);
      expect(openTime, e.name).toMatch(hhmm);
      expect(closeTime, e.name).toMatch(/^([01]\d|2[0-3]):[0-5]\d$|^00:00$/);
    }
  });
});

describe("buildSportPriceRules", () => {
  it("produces OFF_PEAK / PEAK / WEEKEND rules inside the sport band", () => {
    for (const slug of Object.keys(SPORT_PRICE_RANGES) as SportSlug[]) {
      const [min, max] = SPORT_PRICE_RANGES[slug];
      const rules = buildSportPriceRules(slug, "06:00", "22:00");
      expect(rules.map((r) => r.ruleType)).toEqual(["OFF_PEAK", "PEAK", "WEEKEND"]);
      for (const r of rules) {
        expect(r.pricePerHour).toBeGreaterThanOrEqual(min);
        expect(r.pricePerHour).toBeLessThanOrEqual(max);
      }
      const offPeak = rules[0];
      const peak = rules[1];
      expect(offPeak.startHour).toBe(6);
      expect(offPeak.endHour).toBe(17);
      expect(peak.startHour).toBe(17);
      expect(peak.endHour).toBe(22);
      expect(rules[2].isWeekend).toBe(true);
    }
  });

  it("a midnight close (00:00) becomes a 24:00 peak end", () => {
    const rules = buildSportPriceRules("cau-long", "05:00", "00:00");
    expect(rules[1].endHour).toBe(24);
  });

  it("peak stays above off-peak (weekend in between) at band-midpoint pricing", () => {
    const rules = buildSportPriceRules("bong-da-mini", "06:00", "23:00");
    expect(rules[1].pricePerHour).toBeGreaterThan(rules[0].pricePerHour);
    expect(rules[2].pricePerHour).toBeGreaterThanOrEqual(rules[0].pricePerHour);
  });
});
