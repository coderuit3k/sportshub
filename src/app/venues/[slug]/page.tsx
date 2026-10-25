import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getAvailability } from "@/services/bookings";
import { todayDateISO, formatTimeHHMM } from "@/lib/time/tz";
import { BookingWidget, FavoriteButton } from "@/components/client-widgets";
import VenueImage from "@/components/VenueImage";
import SportIcon from "@/components/SportIcon";
import AmenityIcon from "@/components/AmenityIcon";
import { formatVND } from "@/lib/booking/logic";
import { MapPin, Star, Clock, ShieldCheck, Navigation } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { amenityName, sportName } from "@/i18n/vocab";
import { DATE_TIME_OPTIONS } from "@/i18n/format";

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
  const t = await getTranslations("venueDetail");
  const tCommon = await getTranslations("common");
  const tSports = await getTranslations("sports");
  const tAmenities = await getTranslations("amenities");
  const locale = await getLocale();
  const format = await getFormatter();
  const sportLabel = (sportSlug: string, name: string) => sportName((k) => tSports(k), sportSlug, name);

  // Slots are computed for "today" in the business timezone (Asia/Ho_Chi_Minh);
  // the widget fetches other dates from /api/availability with the same semantics.
  const initialDate = todayDateISO();
  const facilitiesDto = [];
  for (const f of venue.facilities) {
    const avail = await getAvailability(f.id, initialDate);
    facilitiesDto.push({
      id: f.id, name: `${f.name} — ${sportLabel(f.sport.slug, f.sport.name)}`,
      slots: (avail?.slots ?? []).map((s) => ({ startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(), startTime: formatTimeHHMM(s.startAt), price: s.price, available: s.available })),
    });
  }
  const dayNames = t.raw("days") as unknown as string[];
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
        {/* Hero: same curated sport photo as the venue cards, larger;
            falls back to the gradient banner when the sport has no photo. */}
        <div className="relative h-64 overflow-hidden rounded-3xl">
          <VenueImage
            primarySportSlug={venue.sports[0]?.sport.slug ?? null}
            venueSlug={venue.slug}
            venueName={venue.name}
            className="absolute inset-0"
            gradientClassName="from-primary via-secondary to-accent"
            emojiClassName="text-6xl"
            emojiAlign="right"
            sizes="(max-width: 1024px) 100vw, 800px"
          />
          <span className="absolute bottom-6 left-6 z-10 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-primary"><ShieldCheck className="mr-1 inline h-4 w-4" />{t("verified")}</span>
        </div>
        <div>
          <h1 className="text-3xl font-extrabold">{venue.name}</h1>
          <p className="mt-1 flex items-center gap-1 text-slate-500"><MapPin className="h-4 w-4" /> {venue.address}, {venue.district}, {venue.city}</p>
          <p className="mt-1 flex items-center gap-1"><Star className="h-4 w-4 fill-accent text-accent" /> <strong>{venue.ratingAvg.toFixed(1)}</strong> {tCommon("reviewsCount", { count: venue.ratingCount })}</p>
          <div className="mt-2 flex flex-wrap gap-1">{venue.sports.map((s) => <span key={s.id} className="chip"><SportIcon slug={s.sport.slug} />{sportLabel(s.sport.slug, s.sport.name)}</span>)}{venue.beginnerFriendly && <span className="chip">{t("beginner")}</span>}{venue.familyFriendly && <span className="chip">{t("family")}</span>}</div>
        </div>
        <section className="card p-5"><h2 className="mb-2 font-bold">{t("about")}</h2><p>{venue.description}</p>
          <h3 className="mb-1 mt-4 font-bold">{t("amenities")}</h3><ul className="flex flex-wrap gap-2">{venue.amenities.map((a) => <li key={a.id} className="chip"><AmenityIcon name={a.name} className="h-3.5 w-3.5" />{amenityName((k) => tAmenities(k), a.name)}</li>)}</ul>
          <h3 className="mb-1 mt-4 font-bold">{t("facilities")}</h3><ul className="list-inside list-disc">{venue.facilities.map((f) => <li key={f.id}>{t("facilityLine", { name: f.name, sport: sportLabel(f.sport.slug, f.sport.name), surface: f.surface ?? "", capacity: f.capacity })}</li>)}</ul>
        </section>
        <section className="card p-5">
          <h2 className="mb-2 font-bold">{t("location")}</h2>
          <p className="flex items-center gap-1 text-sm text-slate-600"><MapPin className="h-4 w-4" /> {venue.address}, {venue.district}, {venue.city}</p>
          <a href={directionsUrl} target="_blank" rel="noreferrer" className="btn-primary mt-3 inline-flex items-center gap-2">
            <Navigation className="h-4 w-4" /> {t("directions")}
          </a>
          {osmEmbedUrl && (
            <>
              <iframe
                title={t("mapTitle", { name: venue.name })}
                src={osmEmbedUrl}
                className="mt-4 h-64 w-full rounded-2xl border"
                loading="lazy"
              />
              <p className="mt-1 text-xs text-slate-400">{t("mapCaption")}</p>
            </>
          )}
        </section>
        <section className="card p-5">
          <h2 className="mb-2 font-bold">{t("pricing")}</h2>
          <table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th className="py-1">{t("priceBand")}</th><th>{t("pricePerHour")}</th></tr></thead>
            <tbody>{priceRows.map((r) => <tr key={r.id} className="border-t"><td className="py-2">{r.ruleType === "OFF_PEAK" ? t("ruleOFF_PEAK") : r.ruleType === "PEAK" ? t("rulePEAK") : t("ruleWEEKEND")}</td><td className="font-semibold">{formatVND(r.pricePerHour, locale)}</td></tr>)}</tbody></table>
          <h3 className="mb-1 mt-4 font-bold">{t("cancelPolicy")}</h3>
          <ul className="list-inside list-disc text-sm">
            <li>{t("cancelFull", { hours: venue.cancelFullBeforeHours })}</li>
            <li>{t("cancelPartial", { hours: venue.cancelPartialBeforeHours, percent: venue.cancelPartialFeePercent })}</li>
            <li>{t("cancelNone", { hours: venue.cancelPartialBeforeHours })}</li>
          </ul>
          <p className="mt-2 flex items-center gap-1 text-sm text-slate-500"><Clock className="h-4 w-4" /> {venue.hours[0] ? t("sampleHours", { day: dayNames[venue.hours[0].dayOfWeek], open: venue.hours[0].openTime, close: venue.hours[0].closeTime }) : "—"}</p>
          <p className="mt-1 text-sm">{venue.instantBooking ? t("instantBooking") : t("ownerApproval")}</p>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 font-bold">{t("reviewsHeading")}</h2>
          {venue.reviews.length === 0 ? <p className="text-slate-500">{t("noReviews")}</p> : venue.reviews.map((r) => (
            <div key={r.id} className="border-b py-2 last:border-0"><p><strong>{r.user.name}</strong> — {"★".repeat(r.rating)} {r.isSeed && <em className="text-xs text-slate-400">(seed)</em>}</p><p className="text-sm">{r.comment}</p></div>
          ))}
        </section>
        {venue.sessions.length > 0 && (
          <section className="card p-5"><h2 className="mb-2 font-bold">{t("upcomingSessions")}</h2>
            {venue.sessions.map((s) => <p key={s.id} className="text-sm">{s.title} — {format.dateTime(s.startAt, DATE_TIME_OPTIONS)} <Link className="font-semibold text-primary" href="/community">{t("viewSession")}</Link></p>)}
          </section>
        )}
      </div>
      <div className="space-y-4">
        {user ? <FavoriteButton venueId={venue.id} initial={isFav} /> : <Link href="/login" className="btn-outline w-full">{t("loginToSave")}</Link>}
        <BookingWidget facilities={facilitiesDto} venueName={venue.name} initialDate={initialDate} />
      </div>
    </div>
  );
}
