import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAvailability } from "@/services/bookings";
import { todayDateISO, formatTimeHHMM } from "@/lib/time/tz";
import { BookingWidget, FavoriteButton } from "@/components/client-widgets";
import VenueDetailMapSection from "@/components/VenueDetailMapSection";
import VenueImage from "@/components/VenueImage";
import SportIcon from "@/components/SportIcon";
import AmenityIcon from "@/components/AmenityIcon";
import { formatVND } from "@/lib/booking/logic";
import { getCachedVenueDetail } from "@/lib/public-data";
import { MapPin, Star, ShieldCheck, Navigation } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { amenityName, sportName } from "@/i18n/vocab";
import { DATE_TIME_OPTIONS } from "@/i18n/format";

/**
 * Freshness intent: venue payload (incl. reviews) comes from the
 * data cache in src/lib/public-data.ts with this same 300 s window —
 * reviews can lag up to 5 minutes; admin approve/reject invalidates the
 * "venues" tag immediately. As on the homepage, the cookie-based locale
 * keeps this route rendering per-request, so the language is always the
 * visitor's own (see docs/architecture.md → "Caching & rate limiting").
 * The page renders WITHOUT user context: the favorite button hydrates
 * its auth/saved state client-side from /api/me/favorites, and slot
 * availability below is still computed live per request.
 */
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const v = await getCachedVenueDetail(slug);
  return { title: v ? v.name : "Sân thể thao", description: v?.description };
}

export default async function VenueDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const venue = await getCachedVenueDetail(slug);
  if (!venue) notFound();
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
      slots: (avail?.slots ?? []).map((s) => ({ startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(), startTime: formatTimeHHMM(s.startAt), price: s.price, available: s.available, past: s.past })),
    });
  }
  const priceRows = venue.facilities[0]?.priceRules ?? [];
  // Keyless maps (no API key / no maps provider account):
  // - "Chỉ đường" deep-links to Google Maps directions with a text query.
  // - The map is a Leaflet view over OpenStreetMap raster tiles (no
  //   WebGL needed, unlike the OSM embed iframe) and renders ONLY when
  //   the venue has coordinates; without them the section degrades to
  //   the directions link alone.
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${venue.name} — ${venue.address}, ${venue.district}, ${venue.city}`)}`;
  const hasCoords = venue.latitude != null && venue.longitude != null;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
      <div className="space-y-6">
        {/* Hero: same curated sport photo as the venue cards, larger;
            falls back to the gradient banner when the sport has no photo. */}
        <div className="relative h-64 overflow-hidden rounded-3xl">
          <VenueImage
            primarySportSlug={venue.sports[0]?.slug ?? null}
            venueSlug={venue.slug}
            venueName={venue.name}
            storedImageUrl={venue.imageUrl}
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
          <div className="mt-2 flex flex-wrap gap-1">{venue.sports.map((s) => <span key={s.id} className="chip"><SportIcon slug={s.slug} />{sportLabel(s.slug, s.name)}</span>)}{venue.beginnerFriendly && <span className="chip">{t("beginner")}</span>}{venue.familyFriendly && <span className="chip">{t("family")}</span>}</div>
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
          {hasCoords && (
            <>
              <VenueDetailMapSection latitude={venue.latitude!} longitude={venue.longitude!} />
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
        </section>
        <section className="card p-5">
          <h2 className="mb-3 font-bold">{t("reviewsHeading")}</h2>
          {venue.reviews.length === 0 ? <p className="text-slate-500">{t("noReviews")}</p> : venue.reviews.map((r) => (
            <div key={r.id} className="border-b py-2 last:border-0"><p><strong>{r.userName}</strong> — {"★".repeat(r.rating)} {r.isSeed && <em className="text-xs text-slate-400">(seed)</em>}</p><p className="text-sm">{r.comment}</p></div>
          ))}
        </section>
        {venue.sessions.length > 0 && (
          <section className="card p-5"><h2 className="mb-2 font-bold">{t("upcomingSessions")}</h2>
            {venue.sessions.map((s) => <p key={s.id} className="text-sm">{s.title} — {format.dateTime(new Date(s.startAt), DATE_TIME_OPTIONS)} <Link className="font-semibold text-primary" href="/community">{t("viewSession")}</Link></p>)}
          </section>
        )}
      </div>
      <div className="space-y-4">
        <FavoriteButton venueId={venue.id} loginLabel={t("loginToSave")} />
        <BookingWidget facilities={facilitiesDto} venueName={venue.name} initialDate={initialDate} />
      </div>
    </div>
  );
}
