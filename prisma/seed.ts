import { createPrismaClient } from "../src/lib/prisma-client";
import bcrypt from "bcryptjs";
import { ensureVenueCatalog } from "./catalog-store";
import { ensureRealCatalog } from "./real-catalog";

const prisma = createPrismaClient();

async function main() {
  let db: URL;
  try { db = new URL(process.env.DATABASE_URL ?? ""); }
  catch { throw new Error("DATABASE_URL must be configured for PostgreSQL dev/test seed"); }
  if (process.env.ALLOW_DESTRUCTIVE_SEED !== "true" || process.env.NODE_ENV === "production"
    || !["postgresql:", "postgres:"].includes(db.protocol) || !/\/(?:[a-zA-Z0-9_]+)_(?:test|dev)$/.test(db.pathname)) {
    throw new Error("Destructive seed requires explicit opt-in and a PostgreSQL _test or _dev database");
  }
  console.log("Seeding SportsHub (dev accounts + sports; venues converge to the REAL Google catalog at the end)...");
  // Clean (dev only, idempotent re-seed)
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.review.deleteMany();
  await prisma.googleReview.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.sessionParticipant.deleteMany();
  await prisma.sportsSession.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.bookingStatusHistory.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.blockedTime.deleteMany();
  await prisma.priceRule.deleteMany();
  await prisma.operatingHour.deleteMany();
  await prisma.facility.deleteMany();
  await prisma.venueAmenity.deleteMany();
  await prisma.venueSport.deleteMany();
  await prisma.venueImage.deleteMany();
  await prisma.venueStaff.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.userSportPreference.deleteMany();
  await prisma.userPreference.deleteMany();
  await prisma.sport.deleteMany();
  await prisma.user.deleteMany();

  const hash = await bcrypt.hash("Password123!", 10);
  const player = await prisma.user.create({ data: { email: "player@sportshub.local", passwordHash: hash, name: "Nguyễn Minh Tuấn", role: "PLAYER" } });
  const owner = await prisma.user.create({ data: { email: "owner@sportshub.local", passwordHash: hash, name: "Trần Văn Hùng (Chủ sân)", role: "OWNER" } });
  const admin = await prisma.user.create({ data: { email: "admin@sportshub.local", passwordHash: hash, name: "Admin SportsHub", role: "ADMIN" } });
  await prisma.userPreference.create({ data: { userId: player.id, preferredDistrict: "Thủ Đức", preferredTimeRange: "17:00-21:00" } });

  const sportsData = [
    { name: "Cầu lông", slug: "cau-long", icon: "🏸", description: "Sân cầu lông trong nhà, thảm chuẩn thi đấu" },
    { name: "Pickleball", slug: "pickleball", icon: "🏓", description: "Môn vợt đang lên, dễ chơi cho người mới" },
    { name: "Bóng đá mini", slug: "bong-da-mini", icon: "⚽", description: "Sân cỏ nhân tạo 5-7 người" },
    { name: "Quần vợt", slug: "quan-vot", icon: "🎾", description: "Sân tennis ngoài trời / có mái che" },
    { name: "Bóng rổ", slug: "bong-ro", icon: "🏀", description: "Sân bóng rổ trong nhà và ngoài trời" },
    { name: "Bơi lội", slug: "boi-loi", icon: "🏊", description: "Hồ bơi chuẩn, có làn riêng" },
  ];
  const sports: Record<string, string> = {};
  for (const s of sportsData) {
    const created = await prisma.sport.create({ data: s });
    sports[s.slug] = created.id;
  }

  interface VenueSeed {
    slug: string; name: string; district: string; address: string; sportSlugs: string[];
    venueType: string; beginner: boolean; family: boolean; rating: number; ratingCount: number;
    instant: boolean; status: string; desc: string;
    // DEMO coordinates: plausible fictional points near each district's centre,
    // only used to render the keyless OpenStreetMap embed in local/demo data.
    // NOT surveyed real locations.
    lat: number; lng: number;
  }
  const venueSeeds: VenueSeed[] = [
    { slug: "smash-arena-thu-duc", name: "CLB Cầu Lông Smash Arena Thủ Đức", district: "Thủ Đức", address: "123 Võ Văn Ngân, Thủ Đức", sportSlugs: ["cau-long"], venueType: "INDOOR", beginner: true, family: true, rating: 4.9, ratingCount: 128, instant: true, status: "APPROVED", desc: "12 sân chuẩn BWF, trần cao 11m, đèn LED 600 Lux chống chói.", lat: 10.8503, lng: 106.7553 },
    { slug: "pickle-hub-binh-thanh", name: "PickleHub Bình Thạnh", district: "Bình Thạnh", address: "45 Điện Biên Phủ, Bình Thạnh", sportSlugs: ["pickleball"], venueType: "MIXED", beginner: true, family: true, rating: 4.7, ratingCount: 86, instant: true, status: "APPROVED", desc: "6 sân pickleball, có lớp cho người mới.", lat: 10.8015, lng: 106.7100 },
    { slug: "sai-gon-mini-football-q7", name: "Sân Bóng Mini Sài Gòn Quận 7", district: "Quận 7", address: "789 Nguyễn Thị Thập, Quận 7", sportSlugs: ["bong-da-mini"], venueType: "OUTDOOR", beginner: false, family: true, rating: 4.6, ratingCount: 210, instant: false, status: "APPROVED", desc: "Sân cỏ nhân tạo 7 người, đèn đêm. Đặt sân cần chủ sân duyệt.", lat: 10.7380, lng: 106.7130 },
    { slug: "riverside-tennis-q1", name: "Riverside Tennis Quận 1", district: "Quận 1", address: "12 Tôn Đức Thắng, Quận 1", sportSlugs: ["quan-vot"], venueType: "OUTDOOR", beginner: false, family: false, rating: 4.8, ratingCount: 64, instant: true, status: "APPROVED", desc: "4 sân tennis mặt cứng ven sông.", lat: 10.7820, lng: 106.7060 },
    { slug: "hoops-center-thu-duc", name: "Hoops Center Thủ Đức", district: "Thủ Đức", address: "56 Kha Vạn Cân, Thủ Đức", sportSlugs: ["bong-ro"], venueType: "INDOOR", beginner: true, family: true, rating: 4.5, ratingCount: 52, instant: true, status: "APPROVED", desc: "Sân bóng rổ trong nhà sàn gỗ.", lat: 10.8580, lng: 106.7470 },
    { slug: "aqua-pool-q7", name: "Aqua Pool Quận 7", district: "Quận 7", address: "321 Huỳnh Tấn Phát, Quận 7", sportSlugs: ["boi-loi"], venueType: "MIXED", beginner: true, family: true, rating: 4.6, ratingCount: 97, instant: true, status: "APPROVED", desc: "Hồ bơi 25m, 6 làn, có khu trẻ em.", lat: 10.7250, lng: 106.7280 },
    { slug: "new-court-pending-binh-thanh", name: "Sân Mới Chờ Duyệt Bình Thạnh", district: "Bình Thạnh", address: "99 Xô Viết Nghệ Tĩnh, Bình Thạnh", sportSlugs: ["cau-long", "pickleball"], venueType: "INDOOR", beginner: true, family: false, rating: 0, ratingCount: 0, instant: true, status: "PENDING_APPROVAL", desc: "Cơ sở mới nộp hồ sơ, đang chờ admin duyệt.", lat: 10.8050, lng: 106.7150 },
  ];

  const venueIds: Record<string, string> = {};
  for (const v of venueSeeds) {
    const venue = await prisma.venue.create({
      data: {
        slug: v.slug, name: v.name, description: v.desc, address: v.address, district: v.district,
        latitude: v.lat, longitude: v.lng,
        venueType: v.venueType, beginnerFriendly: v.beginner, familyFriendly: v.family,
        ratingAvg: v.rating, ratingCount: v.ratingCount, instantBooking: v.instant, status: v.status,
        verified: v.status === "APPROVED", ownerId: owner.id,
      },
    });
    venueIds[v.slug] = venue.id;
    await prisma.venueStaff.create({ data: { venueId: venue.id, userId: owner.id, role: "OWNER" } });
    await prisma.venueImage.create({ data: { venueId: venue.id, url: "gradient:green", caption: v.name, sortOrder: 0 } });
    for (const ss of v.sportSlugs) {
      await prisma.venueSport.create({ data: { venueId: venue.id, sportId: sports[ss] } });
    }
    for (const amenity of ["Wifi", "Bãi xe", "Phòng thay đồ", "Cho thuê vợt/bóng", "Nước uống"]) {
      await prisma.venueAmenity.create({ data: { venueId: venue.id, name: amenity } });
    }
    for (let d = 0; d < 7; d++) {
      await prisma.operatingHour.create({ data: { venueId: venue.id, dayOfWeek: d, openTime: "06:00", closeTime: "22:00" } });
    }
    // Facilities: 2 per venue for its first sport
    for (let i = 1; i <= 2; i++) {
      const fac = await prisma.facility.create({
        data: { venueId: venue.id, sportId: sports[v.sportSlugs[0]], name: `Sân ${String(i).padStart(2, "0")}`, surface: v.venueType === "OUTDOOR" ? "Ngoài trời" : "Trong nhà", capacity: 12 },
      });
      await prisma.priceRule.createMany({
        data: [
          { facilityId: fac.id, ruleType: "OFF_PEAK", pricePerHour: 120000, startHour: 6, endHour: 17 },
          { facilityId: fac.id, ruleType: "PEAK", pricePerHour: 180000, startHour: 17, endHour: 22 },
          { facilityId: fac.id, ruleType: "WEEKEND", pricePerHour: 160000, isWeekend: true },
        ],
      });
    }
  }

  // Generated catalog (prisma/venue-catalog.ts): 164 venues after the
  // owner's 2026-10-26 trim, inserted through the same ensure-step
  // production uses, so a fresh local DB ends up with 170 APPROVED
  // venues (30 / 27 / 27 / 30 / 30 / 26 per sport).
  const catalog = await ensureVenueCatalog(prisma);
  console.log(`Catalog venues: +${catalog.inserted} inserted, ${catalog.skipped} already present, ${catalog.removed} retired removed`);

  // Reviews (marked seed)
  const reviewTexts = ["Sân đẹp, đèn sáng, đặt rất nhanh.", "Mặt sân tốt, nhân viên thân thiện.", "Giá hợp lý giờ thấp điểm."];
  let ri = 0;
  for (const slug of ["smash-arena-thu-duc", "pickle-hub-binh-thanh", "sai-gon-mini-football-q7"]) {
    await prisma.review.create({ data: { userId: player.id, venueId: venueIds[slug], rating: 5 - (ri % 2), comment: reviewTexts[ri % reviewTexts.length], isSeed: true } });
    ri++;
  }

  // Community sessions: today + tomorrow, open
  const now = new Date();
  function at(daysAdd: number, hour: number) { const d = new Date(now); d.setDate(d.getDate() + daysAdd); d.setHours(hour, 0, 0, 0); return d; }
  const sessions = [
    { title: "Kèo cầu lông giao lưu Thủ Đức — cần 2 người", sport: "cau-long", venue: "smash-arena-thu-duc", start: at(0, 19), max: 6, cost: 60000, skill: "INTERMEDIATE" },
    { title: "Pickleball cho người mới — hướng dẫn miễn phí", sport: "pickleball", venue: "pickle-hub-binh-thanh", start: at(1, 18), max: 8, cost: 50000, skill: "BEGINNER" },
    { title: "Bóng đá sân 7 Quận 7 — thiếu 3 chân", sport: "bong-da-mini", venue: "sai-gon-mini-football-q7", start: at(1, 20), max: 14, cost: 70000, skill: "ALL" },
  ];
  for (const s of sessions) {
    const created = await prisma.sportsSession.create({
      data: {
        title: s.title, sportId: sports[s.sport], venueId: venueIds[s.venue], organizerId: player.id,
        startAt: s.start, endAt: new Date(s.start.getTime() + 2 * 3600_000), skillLevel: s.skill,
        maxParticipants: s.max, costPerPerson: s.cost, status: "OPEN",
        description: "Kèo cộng đồng mở — tham gia tự do, chưa phải đặt sân đã xác nhận.",
      },
    });
    await prisma.sessionParticipant.create({ data: { sessionId: created.id, userId: player.id, status: "JOINED" } });
  }

  await prisma.auditLog.create({ data: { actorId: admin.id, action: "SEED", entity: "System", details: "Seed dữ liệu hoàn tất" } });

  // Converge onto the REAL catalog (prisma/real-catalog.ts) — the same
  // step production runs in prisma/deploy-db.ts, so a fresh local DB
  // ends up with exactly the 119 real Google venues, same as prod. The
  // fictional flagships/catalog venues created above (and the seed
  // reviews/sessions attached to them) are purged by the step's
  // FK-closure removal; the seed accounts and sports stay.
  const realCatalog = await ensureRealCatalog(prisma);
  console.log(
    `Real catalog: ${realCatalog.purged} fictional purged, +${realCatalog.inserted} real inserted, ` +
      `${realCatalog.googleReviews} google reviews — ${realCatalog.finalGoogleVenues}/${realCatalog.expected} venues`,
  );
  console.log(`Seed done. Accounts: player/owner/admin @sportshub.local / Password123! — Venues: ${realCatalog.finalGoogleVenues} real (Google)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
