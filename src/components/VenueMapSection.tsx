"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { VenueMapPoint } from "@/lib/public-data";

/**
 * Lazy boundary for the venue map: `next/dynamic` with ssr:false keeps
 * Leaflet (library + CSS + marker artwork) out of the initial bundle —
 * the chunk is fetched only when the visitor switches /venues to the
 * map view, which is the only place this section is rendered.
 */
const VenueMap = dynamic(() => import("./VenueMap"), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

function MapPlaceholder() {
  const t = useTranslations("common");
  return (
    <div className="card flex h-[520px] items-center justify-center text-sm text-slate-500" aria-busy="true">
      {t("loading")}
    </div>
  );
}

export default function VenueMapSection({ points }: { points: VenueMapPoint[] }) {
  return <VenueMap points={points} />;
}
