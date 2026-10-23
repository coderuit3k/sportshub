import Link from "next/link";
import { prisma } from "@/lib/db";
import VenueCard from "@/components/VenueCard";
import SportIcon from "@/components/SportIcon";
import { getCurrentUser } from "@/lib/auth";
import { Search, Users } from "lucide-react";
import { formatVND } from "@/lib/booking/logic";
import { todayDateISO, startOfDay } from "@/lib/time/tz";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  const sports = await prisma.sport.findMany({ include: { _count: { select: { venues: true } } } });
  const venues = await prisma.venue.findMany({
    where: { status: "APPROVED" },
    include: { sports: { include: { sport: true } }, facilities: { include: { priceRules: true } } },
    orderBy: { ratingAvg: "desc" }, take: 6,
  });
  const favIds = user ? (await prisma.favorite.findMany({ where: { userId: user.id } })).map((f) => f.venueId) : [];
  // "From today" = from 00:00 Asia/Ho_Chi_Minh today, regardless of server TZ.
  const todayStart = startOfDay(todayDateISO());
  const sessions = await prisma.sportsSession.findMany({
    where: { status: { in: ["OPEN", "FULL"] }, startAt: { gte: todayStart } },
    include: { sport: true, venue: true, participants: { where: { status: "JOINED" } } },
    orderBy: { startAt: "asc" }, take: 3,
  });
  const toCard = (v: typeof venues[number]) => ({
    id: v.id, slug: v.slug, name: v.name, district: v.district, address: v.address,
    ratingAvg: v.ratingAvg, ratingCount: v.ratingCount, beginnerFriendly: v.beginnerFriendly, familyFriendly: v.familyFriendly,
    minPrice: v.facilities.flatMap((f) => f.priceRules.map((r) => r.pricePerHour)).sort((a, b) => a - b)[0] ?? null,
    sports: v.sports.map((s) => s.sport.name), primarySportSlug: v.sports[0]?.sport.slug ?? null, isFavorite: favIds.includes(v.id),
  });
  return (
    <div className="space-y-12">
      <section className="rounded-3xl bg-gradient-to-br from-primary to-secondary p-8 text-white md:p-12">
        <h1 className="max-w-2xl text-3xl font-extrabold leading-tight md:text-5xl">Find Your Sport. Find Your Court. Find Your People.</h1>
        <p className="mt-3 max-w-xl text-white/90">Sports for Everyone — khám phá, đặt sân và ghép kèo thể thao tại TP. Hồ Chí Minh.</p>
        <form action="/venues" method="get" className="mt-6 grid gap-2 rounded-2xl bg-white p-3 text-ink md:grid-cols-5" role="search">
          <select name="sport" className="input" aria-label="Môn thể thao"><option value="">Tất cả môn</option>{sports.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}</select>
          <input name="q" className="input" placeholder="Khu vực / tên sân..." aria-label="Từ khóa" />
          <input name="date" type="date" className="input" aria-label="Ngày" />
          <select name="time" className="input" aria-label="Khung giờ"><option value="">Mọi giờ</option><option value="morning">Sáng</option><option value="afternoon">Chiều</option><option value="evening">Tối (giờ vàng)</option></select>
          <button className="btn-primary" type="submit"><Search className="h-4 w-4" /> Tìm sân</button>
        </form>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold">Môn thể thao phổ biến</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {sports.map((s) => (
            <Link key={s.id} href={`/venues?sport=${s.slug}`} className="card p-4 text-center hover:shadow-md">
              <p><SportIcon slug={s.slug} className="text-3xl" /></p><p className="mt-1 font-bold">{s.name}</p>
              <p className="text-sm text-slate-500">{s._count.venues} cụm sân</p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between"><h2 className="text-2xl font-bold">Sân được đề xuất</h2><Link className="font-semibold text-primary" href="/venues">Xem tất cả →</Link></div>
        {venues.length === 0 ? <p className="card p-6 text-slate-500">Chưa có dữ liệu sân — hãy chạy seed (npm run db:seed).</p>
          : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{venues.map((v) => <VenueCard key={v.id} v={toCard(v)} />)}</div>}
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold"><Users className="text-primary" /> Kèo Play Together đang mở</h2>
        {sessions.length === 0 ? <p className="card p-6 text-slate-500">Hiện chưa có kèo mở.</p> : (
          <div className="grid gap-4 md:grid-cols-3">
            {sessions.map((s) => (
              <article key={s.id} className="card p-4">
                <p className="chip"><SportIcon slug={s.sport.slug} />{s.sport.name}</p>
                <h3 className="mt-2 font-bold">{s.title}</h3>
                <p className="text-sm text-slate-500">{s.venue?.name ?? "Chưa chốt sân"} — {s.startAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p>
                <p className="mt-1 text-sm">{s.participants.length}/{s.maxParticipants} người — {formatVND(s.costPerPerson)}/người (dự kiến, kèo cộng đồng chưa phải đặt sân đã xác nhận)</p>
                <Link href="/community" className="mt-3 inline-block font-semibold text-primary">Tham gia →</Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card flex flex-col items-start gap-3 bg-accent-light p-8 md:flex-row md:items-center md:justify-between">
        <div><h2 className="text-2xl font-bold">Bạn là chủ sân?</h2><p>Quản lý lịch, giá, duyệt đặt sân và doanh thu trên SportsHub.</p></div>
        <Link href="/register" className="btn-primary">Trở thành đối tác sân</Link>
      </section>
    </div>
  );
}
