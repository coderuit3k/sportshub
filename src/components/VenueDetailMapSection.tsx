"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

/**
 * Lazy boundary for the venue detail map: `next/dynamic` with ssr:false
 * keeps Leaflet (library + CSS + marker artwork) out of the initial
 * bundle — the chunk is fetched only on venue detail pages, the only
 * place this section is rendered. Mirrors VenueMapSection.
 */
const VenueDetailMap = dynamic(() => import("./VenueDetailMap"), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

function MapPlaceholder() {
  const t = useTranslations("common");
  return (
    <div className="mt-4 flex h-80 w-full items-center justify-center rounded-2xl border text-sm text-slate-500" aria-busy="true">
      {t("loading")}
    </div>
  );
}

export default function VenueDetailMapSection({ latitude, longitude }: { latitude: number; longitude: number }) {
  return <VenueDetailMap latitude={latitude} longitude={longitude} />;
}
