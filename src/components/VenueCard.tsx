import Link from "next/link";
import { MapPin, Star } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatVND } from "@/lib/booking/logic";
import { formatDistance } from "@/lib/geo/rank";
import { sportName } from "@/i18n/vocab";
import VenueImage from "@/components/VenueImage";
import FavoriteHeart from "@/components/FavoriteHeart";

export interface VenueCardSport { slug: string; name: string }
export interface VenueCardData {
  id: string; slug: string; name: string; district: string; address: string;
  ratingAvg: number; ratingCount: number; beginnerFriendly: boolean; familyFriendly: boolean;
  minPrice: number | null; sports: VenueCardSport[]; primarySportSlug?: string | null;
  isFavorite?: boolean;
  /** Straight-line distance from the visitor's position, when known (geolocation ranking). */
  distanceKm?: number | null;
}
export default function VenueCard({ v }: { v: VenueCardData }) {
  const t = useTranslations("common");
  const tSports = useTranslations("sports");
  const locale = useLocale();
  const primarySport = v.sports[0]
    ? sportName((k) => tSports(k), v.sports[0].slug, v.sports[0].name)
    : t("sportFallback");
  return (
    <article className="card flex flex-col">
      {/* Banner: curated photo of the venue's primary sport (VenueImage);
          sports without a verified photo fall back to the gradient + emoji.
          Overlays (sport chip, favorite heart) stay above the image. */}
      <div className="relative h-40 overflow-hidden">
        <VenueImage primarySportSlug={v.primarySportSlug} venueSlug={v.slug} venueName={v.name} className="absolute inset-0" />
        <span className="absolute right-3 top-3 z-10 chip bg-white/90">{primarySport}</span>
        <FavoriteHeart venueId={v.id} initial={v.isFavorite ?? false} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        {/* prefetch={false}: the detail page is force-dynamic and computes live
            availability for every facility. Prefetching every card on a list page
            fires a storm of full server renders (12 links / 6 venues) that wastes
            server work and can starve the actual click navigation — observed as
            ~50% aborted RSC navigations against the local SQLite stack. */}
        <h3 className="font-bold leading-snug"><Link prefetch={false} href={`/venues/${v.slug}`} className="hover:text-primary">{v.name}</Link></h3>
        <p className="flex items-center gap-1 text-sm text-slate-500"><MapPin className="h-4 w-4" /> {v.district} — {v.address}</p>
        {v.distanceKm != null && (
          <p className="flex items-center gap-1 text-sm font-medium text-primary"><MapPin className="h-4 w-4" /> {t("distanceFromYou", { distance: formatDistance(v.distanceKm, locale) })}</p>
        )}
        <p className="flex items-center gap-1 text-sm">
          <Star className="h-4 w-4 fill-accent text-accent" />
          <strong>{v.ratingAvg > 0 ? v.ratingAvg.toFixed(1) : t("newVenue")}</strong>
          <span className="text-slate-500">{t("reviewsCount", { count: v.ratingCount })}</span>
        </p>
        <div className="flex flex-wrap gap-1">
          {v.beginnerFriendly && <span className="chip">{t("beginnerFriendly")}</span>}
          {v.familyFriendly && <span className="chip">{t("familyFriendly")}</span>}
        </div>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="font-bold text-primary">{v.minPrice ? t("priceFrom", { price: formatVND(v.minPrice, locale) }) : t("priceOnRequest")}</span>
          <Link prefetch={false} href={`/venues/${v.slug}`} className="btn-primary !px-3 !py-1.5 text-sm">{t("viewAndBook")}</Link>
        </div>
      </div>
    </article>
  );
}
