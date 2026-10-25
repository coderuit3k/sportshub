import Link from "next/link";
import { prisma } from "@/lib/db";
import VenueCard from "@/components/VenueCard";
import { getCurrentUser } from "@/lib/auth";
import { getLocale, getTranslations } from "next-intl/server";
import { formatVND } from "@/lib/booking/logic";
import { sportName } from "@/i18n/vocab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tìm sân" };

interface SP { sport?: string; q?: string; district?: string; maxPrice?: string; minRating?: string; type?: string; beginner?: string; family?: string; sort?: string; date?: string; time?: string }

export default async function VenuesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const t = await getTranslations("venues");
  const tSports = await getTranslations("sports");
  const locale = await getLocale();
  const sportLabel = (slug: string, name: string) => sportName((k) => tSports(k), slug, name);
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
      <form method="get" className="card h-fit space-y-3 p-4" aria-label={t("filters")}>
        <h2 className="font-bold">{t("filters")}</h2>
        <div><label className="label" htmlFor="q">{t("keyword")}</label><input id="q" name="q" className="input" defaultValue={sp.q ?? ""} placeholder={t("keywordPlaceholder")} /></div>
        <div><label className="label" htmlFor="sport">{t("sport")}</label><select id="sport" name="sport" className="input" defaultValue={sp.sport ?? ""}><option value="">{t("all")}</option>{sports.map((s) => <option key={s.id} value={s.slug}>{sportLabel(s.slug, s.name)}</option>)}</select></div>
        <div><label className="label" htmlFor="district">{t("district")}</label><select id="district" name="district" className="input" defaultValue={sp.district ?? ""}><option value="">{t("all")}</option>{districts.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
        <div><label className="label" htmlFor="maxPrice">{t("maxPrice")}</label><select id="maxPrice" name="maxPrice" className="input" defaultValue={sp.maxPrice ?? ""}><option value="">{t("noLimit")}</option>{[120000, 160000, 180000, 500000].map((p) => <option key={p} value={p}>{t("priceUpTo", { price: formatVND(p, locale) })}</option>)}</select></div>
        <div><label className="label" htmlFor="minRating">{t("minRating")}</label><select id="minRating" name="minRating" className="input" defaultValue={sp.minRating ?? ""}><option value="">{t("anyRating")}</option><option value="4.5">{t("ratingAtLeast", { rating: "4.5" })}</option><option value="4">{t("ratingAtLeast", { rating: "4.0" })}</option></select></div>
        <div><label className="label" htmlFor="type">{t("type")}</label><select id="type" name="type" className="input" defaultValue={sp.type ?? ""}><option value="">{t("all")}</option><option value="INDOOR">{t("indoor")}</option><option value="OUTDOOR">{t("outdoor")}</option><option value="MIXED">{t("mixed")}</option></select></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="beginner" value="1" defaultChecked={!!sp.beginner} /> {t("beginner")}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="family" value="1" defaultChecked={!!sp.family} /> {t("family")}</label>
        <div><label className="label" htmlFor="sort">{t("sort")}</label><select id="sort" name="sort" className="input" defaultValue={sp.sort ?? ""}><option value="">{t("sortRecommended")}</option><option value="price-asc">{t("sortPriceAsc")}</option><option value="rating">{t("sortRating")}</option><option value="newest">{t("sortNewest")}</option></select></div>
        <button className="btn-primary w-full" type="submit">{t("apply")}</button>
        <Link href="/venues" className="block text-center text-sm font-medium text-primary">{t("clear")}</Link>
      </form>
      <section>
        <h1 className="mb-4 text-2xl font-bold">{t("heading")} <span className="text-base font-normal text-slate-500">{t("resultsCount", { count: sorted.length })}</span></h1>
        {sorted.length === 0 ? (
          <div className="card p-8 text-center text-slate-500">{t("empty")}<br /><Link className="font-semibold text-primary" href="/venues">{t("viewAllVenues")}</Link></div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map(({ v, minPrice }) => (
              <VenueCard key={v.id} v={{ id: v.id, slug: v.slug, name: v.name, district: v.district, address: v.address, ratingAvg: v.ratingAvg, ratingCount: v.ratingCount, beginnerFriendly: v.beginnerFriendly, familyFriendly: v.familyFriendly, minPrice, sports: v.sports.map((s) => ({ slug: s.sport.slug, name: s.sport.name })), primarySportSlug: v.sports[0]?.sport.slug ?? null, isFavorite: favIds.includes(v.id) }} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
