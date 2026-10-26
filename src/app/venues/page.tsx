import Link from "next/link";
import { prisma } from "@/lib/db";
import VenueCard from "@/components/VenueCard";
import { getCurrentUser } from "@/lib/auth";
import { getCachedSportsAndDistricts, getCachedVenueList, type VenueListFilters } from "@/lib/public-data";
import { getLocale, getTranslations } from "next-intl/server";
import { formatVND } from "@/lib/booking/logic";
import { sportName } from "@/i18n/vocab";

export const metadata = { title: "Tìm sân" };

interface SP { sport?: string; q?: string; district?: string; maxPrice?: string; minRating?: string; type?: string; beginner?: string; family?: string; sort?: string; date?: string; time?: string; page?: string }

const PAGE_SIZE = 12;

export default async function VenuesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const t = await getTranslations("venues");
  const tSports = await getTranslations("sports");
  const locale = await getLocale();
  const sportLabel = (slug: string, name: string) => sportName((k) => tSports(k), slug, name);
  // The filtered venue query is data-cached (60 s, tag "venues") keyed by
  // these normalized filters — repeat searches don't hit the database.
  // The page itself stays per-request (searchParams + the visitor's own
  // favorites), so results are never shared across users.
  const filters: VenueListFilters = {
    sport: sp.sport || null,
    q: sp.q || null,
    district: sp.district || null,
    maxPrice: sp.maxPrice ? Number(sp.maxPrice) : null,
    minRating: sp.minRating ? Number(sp.minRating) : null,
    type: sp.type || null,
    beginner: !!sp.beginner,
    family: !!sp.family,
    sort: sp.sort || null,
  };
  const { sports, districts } = await getCachedSportsAndDistricts();
  const sorted = await getCachedVenueList(filters);
  // Server-side pagination over the (cached, fully sorted) result set:
  // 12 cards per page, `?page=` preserves every active filter.
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const requestedPage = Number.parseInt(sp.page ?? "", 10);
  const page = Number.isFinite(requestedPage) ? Math.min(Math.max(1, requestedPage), totalPages) : 1;
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ sport: sp.sport, q: sp.q, district: sp.district, maxPrice: sp.maxPrice, minRating: sp.minRating, type: sp.type, beginner: sp.beginner, family: sp.family, sort: sp.sort })) {
      if (value) params.set(key, value);
    }
    params.set("page", String(target));
    return `/venues?${params.toString()}`;
  };
  const favIds = user ? (await prisma.favorite.findMany({ where: { userId: user.id } })).map((f) => f.venueId) : [];
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
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {pageItems.map((v) => (
                <VenueCard key={v.id} v={{ id: v.id, slug: v.slug, name: v.name, district: v.district, address: v.address, ratingAvg: v.ratingAvg, ratingCount: v.ratingCount, beginnerFriendly: v.beginnerFriendly, familyFriendly: v.familyFriendly, minPrice: v.minPrice, sports: v.sports, primarySportSlug: v.primarySportSlug, imageUrl: v.imageUrl, isFavorite: favIds.includes(v.id) }} />
              ))}
            </div>
            {totalPages > 1 && (
              <nav className="mt-6 flex items-center justify-between" aria-label={t("pageStatus", { current: page, total: totalPages })}>
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className="btn-primary !px-3 !py-1.5 text-sm">← {t("prevPage")}</Link>
                ) : (
                  <span className="px-3 py-1.5 text-sm font-medium text-slate-300">← {t("prevPage")}</span>
                )}
                <span className="text-sm font-medium text-slate-600">{t("pageStatus", { current: page, total: totalPages })}</span>
                {page < totalPages ? (
                  <Link href={pageHref(page + 1)} className="btn-primary !px-3 !py-1.5 text-sm">{t("nextPage")} →</Link>
                ) : (
                  <span className="px-3 py-1.5 text-sm font-medium text-slate-300">{t("nextPage")} →</span>
                )}
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}
