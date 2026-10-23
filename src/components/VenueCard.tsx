import Link from "next/link";
import { MapPin, Star, Heart } from "lucide-react";
import { formatVND } from "@/lib/booking/logic";
import VenueImage from "@/components/VenueImage";

export interface VenueCardData {
  id: string; slug: string; name: string; district: string; address: string;
  ratingAvg: number; ratingCount: number; beginnerFriendly: boolean; familyFriendly: boolean;
  minPrice: number | null; sports: string[]; primarySportSlug?: string | null;
  isFavorite?: boolean;
}
export default function VenueCard({ v }: { v: VenueCardData }) {
  return (
    <article className="card flex flex-col">
      {/* Banner: curated photo of the venue's primary sport (VenueImage);
          sports without a verified photo fall back to the gradient + emoji.
          Overlays (sport chip, favorite heart) stay above the image. */}
      <div className="relative h-40 overflow-hidden">
        <VenueImage primarySportSlug={v.primarySportSlug} venueSlug={v.slug} venueName={v.name} className="absolute inset-0" />
        <span className="absolute right-3 top-3 z-10 chip bg-white/90">{v.sports[0] ?? "Thể thao"}</span>
        {v.isFavorite && <Heart className="absolute left-3 top-3 z-10 h-5 w-5 fill-red-500 text-red-500" />}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        {/* prefetch={false}: the detail page is force-dynamic and computes live
            availability for every facility. Prefetching every card on a list page
            fires a storm of full server renders (12 links / 6 venues) that wastes
            server work and can starve the actual click navigation — observed as
            ~50% aborted RSC navigations against the local SQLite stack. */}
        <h3 className="font-bold leading-snug"><Link prefetch={false} href={`/venues/${v.slug}`} className="hover:text-primary">{v.name}</Link></h3>
        <p className="flex items-center gap-1 text-sm text-slate-500"><MapPin className="h-4 w-4" /> {v.district} — {v.address}</p>
        <p className="flex items-center gap-1 text-sm">
          <Star className="h-4 w-4 fill-accent text-accent" />
          <strong>{v.ratingAvg > 0 ? v.ratingAvg.toFixed(1) : "Mới"}</strong>
          <span className="text-slate-500">({v.ratingCount} đánh giá)</span>
        </p>
        <div className="flex flex-wrap gap-1">
          {v.beginnerFriendly && <span className="chip">Thân thiện người mới</span>}
          {v.familyFriendly && <span className="chip">Phù hợp gia đình</span>}
        </div>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="font-bold text-primary">{v.minPrice ? `Từ ${formatVND(v.minPrice)}/giờ` : "Liên hệ giá"}</span>
          <Link prefetch={false} href={`/venues/${v.slug}`} className="btn-primary !px-3 !py-1.5 text-sm">Xem & đặt</Link>
        </div>
      </div>
    </article>
  );
}
