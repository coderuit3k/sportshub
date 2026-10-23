import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getAvailability } from "@/services/bookings";
import { BookingWidget, FavoriteButton } from "@/components/client-widgets";
import { formatVND } from "@/lib/booking/logic";
import { MapPin, Star, Clock, ShieldCheck, Navigation } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const v = await prisma.venue.findUnique({ where: { slug } });
  return { title: v ? v.name : "Sân thể thao", description: v?.description };
}

export default async function VenueDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const venue = await prisma.venue.findUnique({
    where: { slug },
    include: {
      sports: { include: { sport: true } }, amenities: true, facilities: { include: { priceRules: true, sport: true } },
      hours: { orderBy: { dayOfWeek: "asc" } }, reviews: { include: { user: true }, orderBy: { createdAt: "desc" }, take: 10 },
      sessions: { where: { status: { in: ["OPEN", "FULL"] } }, include: { sport: true }, orderBy: { startAt: "asc" }, take: 3 },
    },
  });
  if (!venue || venue.status !== "APPROVED") notFound();
  const user = await getCurrentUser();
  const isFav = user ? !!(await prisma.favorite.findUnique({ where: { userId_venueId: { userId: user.id, venueId: venue.id } } })) : false;

  const facilitiesDto = [];
  for (const f of venue.facilities) {
    const avail = await getAvailability(f.id, new Date());
    facilitiesDto.push({
      id: f.id, name: `${f.name} — ${f.sport.name}`,
      slots: (avail?.slots ?? []).map((s) => ({ startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(), price: s.price, available: s.available })),
    });
  }
  const dayNames = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
  const priceRows = venue.facilities[0]?.priceRules ?? [];
  // Keyless maps (no API key / no maps provider account):
  // - "Chỉ đường" deep-links to Google Maps directions with a text query.
  // - The OpenStreetMap embed renders ONLY when the venue has coordinates;
  //   without them the section degrades to the directions link alone.
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${venue.name} — ${venue.address}, ${venue.district}, ${venue.city}`)}`;
  const hasCoords = venue.latitude != null && venue.longitude != null;
  const osmEmbedUrl = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${venue.longitude! - 0.006}%2C${venue.latitude! - 0.004}%2C${venue.longitude! + 0.006}%2C${venue.latitude! + 0.004}&layer=mapnik&marker=${venue.latitude}%2C${venue.longitude}`
    : null;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
      <div className="space-y-6">
        <div className="flex h-56 items-end rounded-3xl bg-gradient-to-br from-primary via-secondary to-accent p-6">
          <span className="rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-primary"><ShieldCheck className="mr-1 inline h-4 w-4" />Sân đã xác thực (dữ liệu demo hư cấu)</span>
        </div>
        <div>
          <h1 className="text-3xl font-extrabold">{venue.name}</h1>
          <p className="mt-1 flex items-center gap-1 text-slate-500"><MapPin className="h-4 w-4" /> {venue.address}, {venue.district}, {venue.city}</p>
          <p className="mt-1 flex items-center gap-1"><Star className="h-4 w-4 fill-accent text-accent" /> <strong>{venue.ratingAvg.toFixed(1)}</strong> ({venue.ratingCount} đánh giá)</p>
          <div className="mt-2 flex flex-wrap gap-1">{venue.sports.map((s) => <span key={s.id} className="chip">{s.sport.name}</span>)}{venue.beginnerFriendly && <span className="chip">Người mới</span>}{venue.familyFriendly && <span className="chip">Gia đình</span>}</div>
        </div>
        <section className="card p-5"><h2 className="mb-2 font-bold">Giới thiệu</h2><p>{venue.description}</p>
          <h3 className="mb-1 mt-4 font-bold">Tiện ích</h3><ul className="flex flex-wrap gap-2">{venue.amenities.map((a) => <li key={a.id} className="chip">{a.name}</li>)}</ul>
          <h3 className="mb-1 mt-4 font-bold">Sân con</h3><ul className="list-inside list-disc">{venue.facilities.map((f) => <li key={f.id}>{f.name} — {f.sport.name} ({f.surface ?? ""}, sức chứa {f.capacity})</li>)}</ul>
        </section>
        <section className="card p-5">
          <h2 className="mb-2 font-bold">Vị trí & chỉ đường</h2>
          <p className="flex items-center gap-1 text-sm text-slate-600"><MapPin className="h-4 w-4" /> {venue.address}, {venue.district}, {venue.city}</p>
          <a href={directionsUrl} target="_blank" rel="noreferrer" className="btn-primary mt-3 inline-flex items-center gap-2">
            <Navigation className="h-4 w-4" /> Chỉ đường (Google Maps)
          </a>
          {osmEmbedUrl && (
            <>
              <iframe
                title={`Bản đồ vị trí ${venue.name}`}
                src={osmEmbedUrl}
                className="mt-4 h-64 w-full rounded-2xl border"
                loading="lazy"
              />
              <p className="mt-1 text-xs text-slate-400">Bản đồ © OpenStreetMap contributors — vị trí demo gần đúng theo địa chỉ.</p>
            </>
          )}
        </section>
        <section className="card p-5">
          <h2 className="mb-2 font-bold">Bảng giá minh bạch</h2>
          <table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th className="py-1">Khung</th><th>Giá/giờ</th></tr></thead>
            <tbody>{priceRows.map((r) => <tr key={r.id} className="border-t"><td className="py-2">{r.ruleType === "OFF_PEAK" ? "Thấp điểm (06:00–17:00)" : r.ruleType === "PEAK" ? "Giờ vàng (17:00–22:00)" : "Cuối tuần"}</td><td className="font-semibold">{formatVND(r.pricePerHour)}</td></tr>)}</tbody></table>
          <h3 className="mb-1 mt-4 font-bold">Chính sách hủy</h3>
          <ul className="list-inside list-disc text-sm">
            <li>Trước {venue.cancelFullBeforeHours} giờ: hoàn 100%</li>
            <li>Trước {venue.cancelPartialBeforeHours} giờ: phí {venue.cancelPartialFeePercent}%</li>
            <li>Dưới {venue.cancelPartialBeforeHours} giờ: không hoàn</li>
          </ul>
          <p className="mt-2 flex items-center gap-1 text-sm text-slate-500"><Clock className="h-4 w-4" /> Giờ mở cửa mẫu: {venue.hours[0] ? `${dayNames[venue.hours[0].dayOfWeek]} ${venue.hours[0].openTime}–${venue.hours[0].closeTime} (áp dụng cả tuần trong demo)` : "—"}</p>
          <p className="mt-1 text-sm">{venue.instantBooking ? "Đặt sân tức thì — xác nhận ngay khi giữ được slot." : "Sân yêu cầu chủ sân duyệt trước khi xác nhận."}</p>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 font-bold">Đánh giá {venue.reviews.some((r) => r.isSeed) && <span className="text-xs font-normal text-slate-400">(có đánh giá seed/demo được ghi rõ)</span>}</h2>
          {venue.reviews.length === 0 ? <p className="text-slate-500">Chưa có đánh giá.</p> : venue.reviews.map((r) => (
            <div key={r.id} className="border-b py-2 last:border-0"><p><strong>{r.user.name}</strong> — {"★".repeat(r.rating)} {r.isSeed && <em className="text-xs text-slate-400">(seed)</em>}</p><p className="text-sm">{r.comment}</p></div>
          ))}
        </section>
        {venue.sessions.length > 0 && (
          <section className="card p-5"><h2 className="mb-2 font-bold">Kèo sắp tới tại sân này</h2>
            {venue.sessions.map((s) => <p key={s.id} className="text-sm">{s.title} — {s.startAt.toLocaleString("vi-VN")} <Link className="font-semibold text-primary" href="/community">Xem kèo →</Link></p>)}
          </section>
        )}
      </div>
      <div className="space-y-4">
        {user ? <FavoriteButton venueId={venue.id} initial={isFav} /> : <Link href="/login" className="btn-outline w-full">Đăng nhập để lưu yêu thích & đặt sân</Link>}
        <BookingWidget facilities={facilitiesDto} venueName={venue.name} />
      </div>
    </div>
  );
}
