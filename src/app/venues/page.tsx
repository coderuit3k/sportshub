import Link from "next/link";
import { prisma } from "@/lib/db";
import VenueCard from "@/components/VenueCard";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tìm sân" };

interface SP { sport?: string; q?: string; district?: string; maxPrice?: string; minRating?: string; type?: string; beginner?: string; family?: string; sort?: string; date?: string; time?: string }

export default async function VenuesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const sports = await prisma.sport.findMany();
  const districts = [...new Set((await prisma.venue.findMany({ select: { district: true } })).map((v) => v.district))];
  const venues = await prisma.venue.findMany({
    where: {
      status: "APPROVED",
      ...(sp.district ? { district: sp.district } : {}),
      ...(sp.type ? { venueType: sp.type } : {}),
      ...(sp.beginner ? { beginnerFriendly: true } : {}),
      ...(sp.family ? { familyFriendly: true } : {}),
      ...(sp.minRating ? { ratingAvg: { gte: Number(sp.minRating) } } : {}),
      ...(sp.sport ? { sports: { some: { sport: { slug: sp.sport } } } } : {}),
      ...(sp.q ? { OR: [{ name: { contains: sp.q } }, { district: { contains: sp.q } }, { address: { contains: sp.q } }] } : {}),
    },
    include: { sports: { include: { sport: true } }, facilities: { include: { priceRules: true } } },
  });
  const favIds = user ? (await prisma.favorite.findMany({ where: { userId: user.id } })).map((f) => f.venueId) : [];
  const withPrice = venues.map((v) => ({
    v, minPrice: v.facilities.flatMap((f) => f.priceRules.map((r) => r.pricePerHour)).sort((a, b) => a - b)[0] ?? null,
  }));
  const filtered = withPrice.filter((x) => !sp.maxPrice || (x.minPrice !== null && x.minPrice <= Number(sp.maxPrice)));
  const sorted = [...filtered].sort((a, b) => {
    switch (sp.sort) {
      case "price-asc": return (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity);
      case "rating": return b.v.ratingAvg - a.v.ratingAvg;
      case "newest": return b.v.createdAt.getTime() - a.v.createdAt.getTime();
      default: return b.v.ratingAvg - a.v.ratingAvg;
    }
  });
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <form method="get" className="card h-fit space-y-3 p-4" aria-label="Bộ lọc">
        <h2 className="font-bold">Bộ lọc</h2>
        <div><label className="label" htmlFor="q">Từ khóa</label><input id="q" name="q" className="input" defaultValue={sp.q ?? ""} placeholder="Tên sân, địa chỉ..." /></div>
        <div><label className="label" htmlFor="sport">Môn</label><select id="sport" name="sport" className="input" defaultValue={sp.sport ?? ""}><option value="">Tất cả</option>{sports.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="district">Quận/huyện</label><select id="district" name="district" className="input" defaultValue={sp.district ?? ""}><option value="">Tất cả</option>{districts.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
        <div><label className="label" htmlFor="maxPrice">Giá tối đa / giờ</label><select id="maxPrice" name="maxPrice" className="input" defaultValue={sp.maxPrice ?? ""}><option value="">Không giới hạn</option><option value="120000">≤ 120.000 đ</option><option value="160000">≤ 160.000 đ</option><option value="180000">≤ 180.000 đ</option><option value="500000">≤ 500.000 đ</option></select></div>
        <div><label className="label" htmlFor="minRating">Đánh giá từ</label><select id="minRating" name="minRating" className="input" defaultValue={sp.minRating ?? ""}><option value="">Mọi mức</option><option value="4.5">4.5★ trở lên</option><option value="4">4.0★ trở lên</option></select></div>
        <div><label className="label" htmlFor="type">Loại sân</label><select id="type" name="type" className="input" defaultValue={sp.type ?? ""}><option value="">Tất cả</option><option value="INDOOR">Trong nhà</option><option value="OUTDOOR">Ngoài trời</option><option value="MIXED">Hỗn hợp</option></select></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="beginner" value="1" defaultChecked={!!sp.beginner} /> Thân thiện người mới</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="family" value="1" defaultChecked={!!sp.family} /> Phù hợp gia đình</label>
        <div><label className="label" htmlFor="sort">Sắp xếp</label><select id="sort" name="sort" className="input" defaultValue={sp.sort ?? ""}><option value="">Đề xuất</option><option value="price-asc">Giá thấp → cao</option><option value="rating">Đánh giá cao</option><option value="newest">Mới nhất</option></select></div>
        <button className="btn-primary w-full" type="submit">Áp dụng lọc</button>
        <Link href="/venues" className="block text-center text-sm font-medium text-primary">Xóa bộ lọc</Link>
      </form>
      <section>
        <h1 className="mb-4 text-2xl font-bold">Khám phá & đặt sân <span className="text-base font-normal text-slate-500">({sorted.length} kết quả)</span></h1>
        {sorted.length === 0 ? (
          <div className="card p-8 text-center text-slate-500">Không tìm thấy sân phù hợp. Thử nới bộ lọc.<br /><Link className="font-semibold text-primary" href="/venues">Xem mọi sân</Link></div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map(({ v, minPrice }) => (
              <VenueCard key={v.id} v={{ id: v.id, slug: v.slug, name: v.name, district: v.district, address: v.address, ratingAvg: v.ratingAvg, ratingCount: v.ratingCount, beginnerFriendly: v.beginnerFriendly, familyFriendly: v.familyFriendly, minPrice, sports: v.sports.map((s) => s.sport.name), primarySportSlug: v.sports[0]?.sport.slug ?? null, isFavorite: favIds.includes(v.id) }} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
