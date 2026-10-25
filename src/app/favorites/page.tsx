import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import VenueCard from "@/components/VenueCard";
import { getTranslations } from "next-intl/server";
export const dynamic = "force-dynamic";
export const metadata = { title: "Sân yêu thích" };
export default async function FavoritesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations("account");
  const favs = await prisma.favorite.findMany({ where: { userId: user.id }, include: { venue: { include: { sports: { include: { sport: true } }, facilities: { include: { priceRules: true } } } } }, orderBy: { createdAt: "desc" } });
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t("favoritesHeading")}</h1>
      {favs.length === 0 ? <p className="card p-8 text-center text-slate-500">{t("favoritesEmpty")} <Link className="font-semibold text-primary" href="/venues">{t("exploreVenues")}</Link></p>
        : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{favs.map((f) => <VenueCard key={f.id} v={{ id: f.venue.id, slug: f.venue.slug, name: f.venue.name, district: f.venue.district, address: f.venue.address, ratingAvg: f.venue.ratingAvg, ratingCount: f.venue.ratingCount, beginnerFriendly: f.venue.beginnerFriendly, familyFriendly: f.venue.familyFriendly, minPrice: f.venue.facilities.flatMap((x) => x.priceRules.map((r) => r.pricePerHour)).sort((a, b) => a - b)[0] ?? null, sports: f.venue.sports.map((s) => ({ slug: s.sport.slug, name: s.sport.name })), primarySportSlug: f.venue.sports[0]?.sport.slug ?? null, isFavorite: true }} />)}</div>}
    </div>
  );
}
