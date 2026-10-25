/**
 * Generated venue catalog — 29 additional APPROVED venues per sport
 * (174 total), complementing the 6 hand-written flagship venues in
 * prisma/seed.ts so every sport ends up with exactly 30 public venues.
 *
 * The catalog is produced by a DETERMINISTIC generator (mulberry32 PRNG
 * with a fixed seed): every run, on every machine, yields byte-identical
 * definitions. The same definitions feed both the local seed
 * (prisma/seed.ts) and the production ensure-step
 * (prisma/catalog-store.ts → prisma/deploy-db.ts), which inserts only
 * the venues whose slug is still missing.
 *
 * All names, addresses and coordinates are plausible-but-invented HCMC
 * data (real district/street names, jittered coordinates around each
 * district centre) — same convention as the flagship seed venues.
 */

/* ------------------------------------------------------------------ */
/* Deterministic PRNG (mulberry32)                                     */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  bool(probability: number): boolean;
}

function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    shuffle: (items) => {
      const arr = [...items];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    bool: (p) => next() < p,
  };
}

/* ------------------------------------------------------------------ */
/* Static reference data                                               */
/* ------------------------------------------------------------------ */

/** The six sports — identical to the flagship seed (prisma/seed.ts). */
export const SPORT_DEFS = [
  { name: "Cầu lông", slug: "cau-long", icon: "🏸", description: "Sân cầu lông trong nhà, thảm chuẩn thi đấu" },
  { name: "Pickleball", slug: "pickleball", icon: "🏓", description: "Môn vợt đang lên, dễ chơi cho người mới" },
  { name: "Bóng đá mini", slug: "bong-da-mini", icon: "⚽", description: "Sân cỏ nhân tạo 5-7 người" },
  { name: "Quần vợt", slug: "quan-vot", icon: "🎾", description: "Sân tennis ngoài trời / có mái che" },
  { name: "Bóng rổ", slug: "bong-ro", icon: "🏀", description: "Sân bóng rổ trong nhà và ngoài trời" },
  { name: "Bơi lội", slug: "boi-loi", icon: "🏊", description: "Hồ bơi chuẩn, có làn riêng" },
] as const;

export type SportSlug = (typeof SPORT_DEFS)[number]["slug"];

/** Slugs of the six hand-written flagship venues (see prisma/seed.ts). */
export const FLAGSHIP_VENUE_SLUGS = [
  "smash-arena-thu-duc",
  "pickle-hub-binh-thanh",
  "sai-gon-mini-football-q7",
  "riverside-tennis-q1",
  "hoops-center-thu-duc",
  "aqua-pool-q7",
] as const;

interface DistrictDef {
  name: string;
  lat: number;
  lng: number;
  streets: string[];
}

/** HCMC districts with an approximate centre and real street names. */
const DISTRICTS: DistrictDef[] = [
  { name: "Thủ Đức", lat: 10.845, lng: 106.765, streets: ["Võ Văn Ngân", "Kha Vạn Cân", "Đặng Văn Bi", "Hoàng Diệu 2", "Lê Văn Việt", "Tô Vĩnh Diện"] },
  { name: "Quận 1", lat: 10.776, lng: 106.701, streets: ["Tôn Đức Thắng", "Lê Lợi", "Nguyễn Huệ", "Hàm Nghi", "Pasteur", "Điện Biên Phủ"] },
  { name: "Quận 2", lat: 10.79, lng: 106.745, streets: ["Thảo Điền", "Quốc Hương", "Nguyễn Văn Hưởng", "Trần Não", "Lương Định Của"] },
  { name: "Quận 3", lat: 10.783, lng: 106.689, streets: ["Võ Văn Tần", "Nguyễn Đình Chiểu", "Nam Kỳ Khởi Nghĩa", "Cách Mạng Tháng 8"] },
  { name: "Quận 4", lat: 10.758, lng: 106.702, streets: ["Khánh Hội", "Hoàng Diệu", "Tôn Thất Thuyết", "Nguyễn Tất Thành"] },
  { name: "Quận 5", lat: 10.754, lng: 106.663, streets: ["Nguyễn Trãi", "Trần Hưng Đạo", "An Dương Vương", "Nguyễn Chí Thanh"] },
  { name: "Quận 6", lat: 10.748, lng: 106.635, streets: ["Hậu Giang", "Phạm Đình Hổ", "Lò Gốm", "Nguyễn Văn Luông"] },
  { name: "Quận 7", lat: 10.732, lng: 106.72, streets: ["Nguyễn Thị Thập", "Huỳnh Tấn Phát", "Nguyễn Văn Linh", "Lâm Văn Bền", "Tân Mỹ"] },
  { name: "Quận 8", lat: 10.724, lng: 106.628, streets: ["Phạm Thế Hiển", "Hưng Phú", "Tùng Thiện Vương", "Dương Bá Trạc"] },
  { name: "Quận 10", lat: 10.773, lng: 106.668, streets: ["Sư Vạn Hạnh", "Lý Thường Kiệt", "Ba Tháng Hai", "Nguyễn Tri Phương"] },
  { name: "Quận 11", lat: 10.763, lng: 106.65, streets: ["Lạc Long Quân", "Ông Ích Khiêm", "Lãnh Binh Thăng", "Hàn Hải Nguyên"] },
  { name: "Quận 12", lat: 10.855, lng: 106.655, streets: ["Lê Văn Khương", "Nguyễn Ảnh Thủ", "Tô Ký", "Hà Huy Giáp"] },
  { name: "Bình Thạnh", lat: 10.803, lng: 106.71, streets: ["Điện Biên Phủ", "Xô Viết Nghệ Tĩnh", "Phan Văn Trị", "Nguyễn Xí", "Bạch Đằng"] },
  { name: "Gò Vấp", lat: 10.839, lng: 106.665, streets: ["Quang Trung", "Phạm Văn Chiêu", "Lê Đức Thọ", "Nguyễn Oanh", "Phan Văn Trị"] },
  { name: "Tân Bình", lat: 10.8, lng: 106.652, streets: ["Cộng Hòa", "Hoàng Văn Thụ", "Trường Chinh", "Lý Thường Kiệt", "Âu Cơ"] },
  { name: "Tân Phú", lat: 10.79, lng: 106.628, streets: ["Lũy Bán Bích", "Tân Kỳ Tân Quý", "Nguyễn Sơn", "Hòa Bình"] },
  { name: "Phú Nhuận", lat: 10.799, lng: 106.68, streets: ["Phan Đăng Lưu", "Nguyễn Văn Trỗi", "Hoa Sứ", "Huỳnh Văn Bánh"] },
  { name: "Bình Tân", lat: 10.765, lng: 106.605, streets: ["Kinh Dương Vương", "Tên Lửa", "Mã Lò", "Hương Lộ 2"] },
  { name: "Nhà Bè", lat: 10.695, lng: 106.745, streets: ["Huỳnh Tấn Phát", "Nguyễn Hữu Thọ", "Lê Văn Lương", "Nguyễn Bình"] },
  { name: "Bình Chánh", lat: 10.7, lng: 106.56, streets: ["Nguyễn Văn Linh", "Quốc Lộ 1A", "Trần Đại Nghĩa", "Vĩnh Lộc"] },
  { name: "Hóc Môn", lat: 10.88, lng: 106.595, streets: ["Lý Thường Kiệt", "Quang Trung", "Song Hành", "Phan Văn Hớn"] },
  { name: "Củ Chi", lat: 10.973, lng: 106.495, streets: ["Quốc Lộ 22", "Tỉnh Lộ 8", "Nguyễn Thị Rành", "Bàu Tre"] },
];

/** Brand-like / landmark distinctive names used to compose venue names. */
const DISTINCTIVE_NAMES = [
  "An Phú", "Bình Minh", "Sao Mai", "Hoàng Gia", "Phương Đông", "Tân Tiến",
  "Hùng Vương", "Quang Trung", "Lê Lợi", "Thống Nhất", "Hòa Bình", "Tuổi Trẻ",
  "Chiến Thắng", "Đoàn Kết", "Sinh Viên", "Riverside", "Green Park", "City Park",
  "Năng Động", "Sông Sài Gòn", "Tân Hương", "Phú Thọ", "Văn Lang", "Âu Lạc",
  "Hồng Bàng", "Lạc Long", "Thăng Long", "Gia Định", "Chợ Lớn", "Bến Nghé",
  "Thủ Thiêm", "Thảo Nguyên", "Mặt Trời", "Ánh Dương", "Bình An", "Phúc Lộc",
  "Trường Sơn", "Hải Đăng", "Cánh Buồm", "Đại Dương", "Suối Tiên", "Vườn Lan",
  "Phố Đông", "Tây Đô", "Nam Sài Gòn", "Bắc Sài Gòn", "Đông Sài Gòn", "Kim Liên",
] as const;

/** The known amenity vocabulary (same set the flagship seed uses). */
export const KNOWN_AMENITIES = ["Wifi", "Bãi xe", "Phòng thay đồ", "Cho thuê vợt/bóng", "Nước uống"] as const;

/* ------------------------------------------------------------------ */
/* Per-sport generation config                                         */
/* ------------------------------------------------------------------ */

interface SportConfig {
  namePatterns: string[]; // "{X}" is replaced by the distinctive name
  venueTypes: string[];
  facilityCount: [number, number];
  facilityName: (index: number) => string;
  surfaces: string[];
  capacity: number;
  /** Hourly price band (VND) every price rule must stay inside. */
  priceRange: [number, number];
  descriptions: string[]; // templates: {n} courts, {district}, {extra}
}

const courtName = (i: number) => `Sân ${String(i + 1).padStart(2, "0")}`;

const SPORT_CONFIG: Record<SportSlug, SportConfig> = {
  "cau-long": {
    namePatterns: ["CLB Cầu Lông {X}", "Sân Cầu Lông {X}", "Trung Tâm Cầu Lông {X}", "Nhà Thi Đấu Cầu Lông {X}"],
    venueTypes: ["INDOOR", "INDOOR", "MIXED"],
    facilityCount: [4, 10],
    facilityName: courtName,
    surfaces: ["Thảm PVC chuẩn thi đấu", "Thảm cao su tổng hợp", "Sàn gỗ phủ thảm"],
    capacity: 4,
    priceRange: [50_000, 90_000],
    descriptions: [
      "{n} sân thảm PVC chuẩn thi đấu, trần cao thoáng, hệ thống đèn LED chống chói. Có phòng thay đồ, khu gửi đồ và nước uống tại quầy.",
      "Không gian trong nhà rộng rãi với {n} sân cầu lông mặt thảm êm, điều hòa mát lạnh. Phù hợp tập luyện và thi đấu phong trào tại {district}.",
      "{n} sân đạt chuẩn, lưới căng đều, khu vực chờ có ghế và quạt mát. Nhận đặt sân theo giờ và gói tháng cho câu lạc bộ.",
    ],
  },
  pickleball: {
    namePatterns: ["CLB Pickleball {X}", "Sân Pickleball {X}", "Khu Pickleball {X}", "Trung Tâm Pickleball {X}"],
    venueTypes: ["INDOOR", "OUTDOOR", "MIXED"],
    facilityCount: [3, 8],
    facilityName: courtName,
    surfaces: ["Mặt cứng acrylic", "Mặt cứng chống trơn"],
    capacity: 4,
    priceRange: [80_000, 150_000],
    descriptions: [
      "{n} sân mặt cứng acrylic chống trơn, kẻ vạch chuẩn thi đấu. Có lớp hướng dẫn cho người mới vào cuối tuần.",
      "Cụm {n} sân pickleball thoáng mát tại {district}, đèn chiếu sáng đầy đủ cho khung giờ tối. Cho thuê vợt và bóng ngay tại sân.",
      "{n} sân mới kẻ vạch, mặt sân êm chân, khu vực chờ có mái che. Thích hợp giao lưu nhóm và các giải phong trào.",
    ],
  },
  "bong-da-mini": {
    namePatterns: ["Sân Bóng {X}", "Sân Cỏ Nhân Tạo {X}", "Cụm Sân Bóng {X}", "Khu Thể Thao {X}"],
    venueTypes: ["OUTDOOR"],
    facilityCount: [2, 4],
    facilityName: courtName,
    surfaces: ["Cỏ nhân tạo", "Cỏ nhân tạo cao cấp"],
    capacity: 14,
    priceRange: [250_000, 450_000],
    descriptions: [
      "{n} sân cỏ nhân tạo {extra} người, cỏ dày êm, hệ thống đèn đêm sáng đều. Có trọng tài và áo bib theo yêu cầu.",
      "Cụm sân cỏ nhân tạo tại {district} với {n} sân, mặt cỏ mới thay, khung thành chuẩn. Đặt sân theo giờ, có gói cố định cho đội bóng.",
      "{n} sân bóng cỏ nhân tạo, lưới chắn bóng cao, khu vực thay đồ và gửi xe rộng. Mở cửa từ sáng sớm đến khuya.",
    ],
  },
  "quan-vot": {
    namePatterns: ["CLB Quần Vợt {X}", "Sân Tennis {X}", "Trung Tâm Tennis {X}", "CLB Tennis {X}"],
    venueTypes: ["OUTDOOR", "OUTDOOR", "MIXED"],
    facilityCount: [2, 6],
    facilityName: courtName,
    surfaces: ["Mặt cứng acrylic", "Đất nện", "Mặt cứng phủ cao su"],
    capacity: 4,
    priceRange: [120_000, 250_000],
    descriptions: [
      "{n} sân mặt cứng acrylic chuẩn thi đấu, lưới và cột lưới mới. Có huấn luyện viên hướng dẫn cho người mới và lớp nhóm cuối tuần.",
      "Cụm {n} sân tennis tại {district}, mặt sân êm, đèn chiếu sáng cho giờ tối. Cho thuê vợt và căng dây tại chỗ.",
      "{n} sân ngoài trời thoáng gió, hàng rào chắn bóng cao. Phù hợp tập luyện, giao lưu và giải câu lạc bộ.",
    ],
  },
  "bong-ro": {
    namePatterns: ["Sân Bóng Rổ {X}", "CLB Bóng Rổ {X}", "Trung Tâm Bóng Rổ {X}", "Hoops {X}"],
    venueTypes: ["INDOOR", "OUTDOOR", "MIXED"],
    facilityCount: [1, 3],
    facilityName: courtName,
    surfaces: ["Sàn gỗ", "Mặt acrylic ngoài trời", "Sàn nhựa thể thao"],
    capacity: 10,
    priceRange: [100_000, 200_000],
    descriptions: [
      "{n} sân bóng rổ mặt sân êm, vành rổ chuẩn thi đấu, bảng điểm điện tử. Nhận tổ chức giải 3x3 và 5x5.",
      "Cụm {n} sân tại {district} với mặt sân đạt chuẩn, đèn sáng đều. Có lớp bóng rổ trẻ em vào cuối tuần.",
      "{n} sân đạt chuẩn, khu vực khởi động riêng, ghế khán giả dọc sân. Đặt sân theo giờ hoặc thuê trọn buổi cho đội.",
    ],
  },
  "boi-loi": {
    namePatterns: ["Hồ Bơi {X}", "CLB Bơi Lội {X}", "Khu Hồ Bơi {X}", "Trung Tâm Bơi Lội {X}"],
    venueTypes: ["OUTDOOR", "MIXED"],
    facilityCount: [1, 1],
    facilityName: () => "Hồ bơi chính",
    surfaces: ["Hồ bơi ngoài trời", "Hồ bơi có mái che"],
    capacity: 40,
    priceRange: [40_000, 80_000],
    descriptions: [
      "Hồ bơi {extra} làn dài 25m, nước lọc tuần hoàn khép kín, có nhân viên cứu hộ trực thường xuyên. Có khu hồ trẻ em riêng.",
      "Hồ bơi ngoài trời tại {district}, {extra} làn bơi, mái che nắng một phần. Có lớp dạy bơi cho trẻ em và người lớn.",
      "Hồ bơi sạch đẹp, {extra} làn chuẩn, phòng thay đồ và tủ gửi đồ đầy đủ. Vé theo lượt và gói tháng linh hoạt.",
    ],
  },
};

/** Per-sport hourly price bands — exported for the catalog tests. */
export const SPORT_PRICE_RANGES: Record<SportSlug, [number, number]> = Object.fromEntries(
  Object.entries(SPORT_CONFIG).map(([slug, cfg]) => [slug, cfg.priceRange]),
) as Record<SportSlug, [number, number]>;

/* ------------------------------------------------------------------ */
/* Catalog types                                                       */
/* ------------------------------------------------------------------ */

export interface CatalogPriceRule {
  ruleType: "OFF_PEAK" | "PEAK" | "WEEKEND";
  pricePerHour: number;
  startHour?: number;
  endHour?: number;
  isWeekend?: boolean;
}

export interface CatalogFacility {
  name: string;
  surface: string;
  capacity: number;
  priceRules: CatalogPriceRule[];
}

export interface CatalogVenue {
  slug: string;
  name: string;
  description: string;
  address: string;
  district: string;
  latitude: number;
  longitude: number;
  venueType: string;
  beginnerFriendly: boolean;
  familyFriendly: boolean;
  instantBooking: boolean;
  ratingAvg: number;
  ratingCount: number;
  primarySportSlug: SportSlug;
  openTime: string;
  closeTime: string;
  amenities: string[];
  facilities: CatalogFacility[];
}

/** New venues generated per sport (30 target − 1 flagship = 29). */
export const CATALOG_PER_SPORT = 29;

/* ------------------------------------------------------------------ */
/* Generator                                                           */
/* ------------------------------------------------------------------ */

/** Vietnamese-aware slug: strip diacritics, đ → d, spaces → dashes. */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const HCMC_BBOX = { latMin: 10.35, latMax: 10.98, lngMin: 106.35, lngMax: 106.98 };
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round3k = (v: number) => Math.round(v / 1000) * 1000;

const OPEN_TIMES = ["05:00", "05:30", "06:00", "06:30", "07:00"] as const;
const CLOSE_TIMES = ["21:00", "21:30", "22:00", "22:30", "23:00"] as const;

function generateSportVenues(rng: Rng, sportSlug: SportSlug, usedNames: Set<string>, usedSlugs: Set<string>): CatalogVenue[] {
  const cfg = SPORT_CONFIG[sportSlug];
  const distinctive = rng.shuffle(DISTINCTIVE_NAMES);
  // Spread venues across districts: shuffled cycles through all 22.
  const districtCycle: DistrictDef[] = [
    ...rng.shuffle(DISTRICTS),
    ...rng.shuffle(DISTRICTS),
  ];
  const venues: CatalogVenue[] = [];

  for (let i = 0; i < CATALOG_PER_SPORT; i++) {
    const district = districtCycle[i];
    const pattern = cfg.namePatterns[i % cfg.namePatterns.length];
    let name = pattern.replace("{X}", distinctive[i]);
    if (usedNames.has(name)) name = `${name} ${district.name}`;
    if (usedNames.has(name)) name = `${name} ${i + 1}`;
    usedNames.add(name);
    let slug = slugify(name);
    if (usedSlugs.has(slug)) slug = `${slug}-${i + 1}`;
    usedSlugs.add(slug);

    const street = rng.pick(district.streets);
    const address = `${rng.int(1, 998)} ${street}, ${district.name}`;
    const latitude = clamp(round4(district.lat + (rng.next() - 0.5) * 0.045), HCMC_BBOX.latMin, HCMC_BBOX.latMax);
    const longitude = clamp(round4(district.lng + (rng.next() - 0.5) * 0.055), HCMC_BBOX.lngMin, HCMC_BBOX.lngMax);

    const openTime = rng.pick(OPEN_TIMES);
    const closeTime = rng.pick(CLOSE_TIMES);
    const openHour = Number(openTime.slice(0, 2));
    const closeHour = Number(closeTime.slice(0, 2));

    // Facilities + price rules (every rule stays inside the sport band).
    const [priceMin, priceMax] = cfg.priceRange;
    const facilityCount = rng.int(cfg.facilityCount[0], cfg.facilityCount[1]);
    const facilities: CatalogFacility[] = [];
    for (let f = 0; f < facilityCount; f++) {
      const surface = rng.pick(cfg.surfaces);
      const offPeak = round3k(rng.int(priceMin, priceMax));
      const weekend = clamp(round3k(offPeak * 1.15), priceMin, priceMax);
      const peak = clamp(round3k(offPeak * 1.35), priceMin, priceMax);
      facilities.push({
        name: cfg.facilityName(f),
        surface,
        capacity: cfg.capacity,
        priceRules: [
          { ruleType: "OFF_PEAK", pricePerHour: offPeak, startHour: openHour, endHour: 17 },
          { ruleType: "PEAK", pricePerHour: peak, startHour: 17, endHour: closeHour },
          { ruleType: "WEEKEND", pricePerHour: weekend, isWeekend: true },
        ],
      });
    }

    const amenityCount = rng.int(2, KNOWN_AMENITIES.length);
    const amenities = rng.shuffle(KNOWN_AMENITIES).slice(0, amenityCount);

    const extra =
      sportSlug === "bong-da-mini" ? String(rng.pick([5, 7])) : sportSlug === "boi-loi" ? String(rng.int(4, 8)) : "";
    const description = rng
      .pick(cfg.descriptions)
      .replaceAll("{n}", String(facilityCount))
      .replaceAll("{district}", district.name)
      .replaceAll("{extra}", extra);

    venues.push({
      slug,
      name,
      description,
      address,
      district: district.name,
      latitude,
      longitude,
      venueType: rng.pick(cfg.venueTypes),
      beginnerFriendly: rng.bool(0.6),
      familyFriendly: rng.bool(0.5),
      instantBooking: rng.bool(0.7),
      ratingAvg: Math.round((3.9 + rng.int(0, 10) / 10) * 10) / 10,
      ratingCount: rng.int(12, 480),
      primarySportSlug: sportSlug,
      openTime,
      closeTime,
      amenities,
      facilities,
    });
  }
  return venues;
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

/**
 * The full generated catalog: 29 venues × 6 sports = 174 definitions.
 * Deterministic — the PRNG seed is fixed, so this returns identical
 * data on every call.
 *
 * Rating cap: at most 5 generated venues may sit at 4.9★. The flagship
 * Smash Arena is also 4.9★, and the homepage featured row takes the
 * top 6 by rating — the cap guarantees the flagship keeps its slot no
 * matter how ties break. Extra 4.9s are stepped down to 4.8 in
 * generation order.
 */
export function generateCatalog(): CatalogVenue[] {
  const rng = makeRng(20261025);
  const usedNames = new Set<string>();
  const usedSlugs = new Set<string>();
  const venues: CatalogVenue[] = [];
  for (const sport of SPORT_DEFS) {
    venues.push(...generateSportVenues(rng, sport.slug, usedNames, usedSlugs));
  }
  let topRated = 0;
  for (const v of venues) {
    if (v.ratingAvg >= 4.9) {
      topRated += 1;
      if (topRated > 5) v.ratingAvg = 4.8;
    }
  }
  return venues;
}

/** The catalog as a module-level constant (generated once per process). */
export const CATALOG_VENUES: CatalogVenue[] = generateCatalog();
