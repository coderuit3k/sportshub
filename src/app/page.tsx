import Link from "next/link";
import { prisma } from "@/lib/db";
import FeaturedVenues from "@/components/FeaturedVenues";
import SportIcon from "@/components/SportIcon";
import { getCurrentUser } from "@/lib/auth";
import { Search, Users } from "lucide-react";
import { formatVND } from "@/lib/booking/logic";
import { todayDateISO, startOfDay } from "@/lib/time/tz";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { sportName } from "@/i18n/vocab";
import { DATE_TIME_OPTIONS } from "@/i18n/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  const t = await getTranslations("home");
  const tSports = await getTranslations("sports");
  const locale = await getLocale();
  const format = await getFormatter();
  const sportLabel = (slug: string, name: string) => sportName((k) => tSports(k), slug, name);
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
    sports: v.sports.map((s) => ({ slug: s.sport.slug, name: s.sport.name })), primarySportSlug: v.sports[0]?.sport.slug ?? null, isFavorite: favIds.includes(v.id),
    latitude: v.latitude, longitude: v.longitude,
  });
  return (
    <div className="space-y-12">
      <section className="rounded-3xl bg-gradient-to-br from-primary to-secondary p-8 text-white md:p-12">
        <h1 className="max-w-2xl text-3xl font-extrabold leading-tight md:text-5xl">{t("heroTitle")}</h1>
        <p className="mt-3 max-w-xl text-white/90">{t("heroSubtitle")}</p>
        <form action="/venues" method="get" className="mt-6 grid gap-2 rounded-2xl bg-white p-3 text-ink md:grid-cols-5" role="search">
          <select name="sport" className="input" aria-label={t("searchSportAria")}><option value="">{t("allSports")}</option>{sports.map((s) => <option key={s.id} value={s.slug}>{sportLabel(s.slug, s.name)}</option>)}</select>
          <input name="q" className="input" placeholder={t("searchKeywordPlaceholder")} aria-label={t("searchKeywordAria")} />
          <input name="date" type="date" className="input" aria-label={t("searchDateAria")} />
          <select name="time" className="input" aria-label={t("searchTimeAria")}><option value="">{t("anyTime")}</option><option value="morning">{t("morning")}</option><option value="afternoon">{t("afternoon")}</option><option value="evening">{t("evening")}</option></select>
          <button className="btn-primary" type="submit"><Search className="h-4 w-4" /> {t("searchButton")}</button>
        </form>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold">{t("sportsHeading")}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {sports.map((s) => (
            <Link key={s.id} href={`/venues?sport=${s.slug}`} className="card p-4 text-center hover:shadow-md">
              <p><SportIcon slug={s.slug} className="text-3xl" /></p><p className="mt-1 font-bold">{sportLabel(s.slug, s.name)}</p>
              <p className="text-sm text-slate-500">{t("venueClusters", { count: s._count.venues })}</p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between"><h2 className="text-2xl font-bold">{t("featuredHeading")}</h2><Link className="font-semibold text-primary" href="/venues">{t("viewAll")}</Link></div>
        <FeaturedVenues venues={venues.map(toCard)} />
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold"><Users className="text-primary" /> {t("sessionsHeading")}</h2>
        {sessions.length === 0 ? <p className="card p-6 text-slate-500">{t("noSessions")}</p> : (
          <div className="grid gap-4 md:grid-cols-3">
            {sessions.map((s) => (
              <article key={s.id} className="card p-4">
                <p className="chip"><SportIcon slug={s.sport.slug} />{sportLabel(s.sport.slug, s.sport.name)}</p>
                <h3 className="mt-2 font-bold">{s.title}</h3>
                <p className="text-sm text-slate-500">{s.venue?.name ?? t("venueTbd")} — {format.dateTime(s.startAt, DATE_TIME_OPTIONS)}</p>
                <p className="mt-1 text-sm">{t("sessionMeta", { joined: s.participants.length, max: s.maxParticipants, price: formatVND(s.costPerPerson, locale) })}</p>
                <Link href="/community" className="mt-3 inline-block font-semibold text-primary">{t("join")}</Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card flex flex-col items-start gap-3 bg-accent-light p-8 md:flex-row md:items-center md:justify-between">
        <div><h2 className="text-2xl font-bold">{t("ownerTitle")}</h2><p>{t("ownerText")}</p></div>
        <Link href="/register" className="btn-primary">{t("ownerButton")}</Link>
      </section>
    </div>
  );
}
