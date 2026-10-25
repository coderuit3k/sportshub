"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Locate, MapPin, X } from "lucide-react";
import VenueCard, { type VenueCardData } from "@/components/VenueCard";
import { rankVenues, type UserPosition } from "@/lib/geo/rank";

/**
 * Homepage "Sân nổi bật" (featured venues) with browser geolocation.
 *
 * Ranking (see src/lib/geo/rank.ts): rating → distance → price. The
 * initial render has no position, so it ranks by rating → price and the
 * server-rendered HTML already contains the full cards. Clicking "Dùng
 * vị trí của tôi" asks the browser for the position — it is processed
 * entirely on the client and never sent to the server — and re-ranks.
 * Denial, timeout or an unsupported browser keeps the default ranking
 * and shows a short explanatory note; the list never breaks.
 *
 * All UI copy comes from the `home.featured` message namespace.
 */

export interface FeaturedVenueData extends VenueCardData {
  latitude: number | null;
  longitude: number | null;
}

type GeoStatus = "idle" | "loading" | "granted" | "error";

export default function FeaturedVenues({ venues }: { venues: FeaturedVenueData[] }) {
  const t = useTranslations("home.featured");
  const [userPos, setUserPos] = useState<UserPosition | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");

  const ranked = useMemo(() => rankVenues(venues, userPos), [venues, userPos]);

  function requestLocation() {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus("granted");
      },
      () => {
        setUserPos(null);
        setStatus("error");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  function resetLocation() {
    setUserPos(null);
    setStatus("idle");
  }

  return (
    <div>
      {status === "granted" ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600" role="status">
          <MapPin className="h-4 w-4 text-primary" />
          <span>{t("rankedStatus")}</span>
          <button type="button" onClick={resetLocation} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            <X className="h-4 w-4" /> {t("resetLocation")}
          </button>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={requestLocation}
            disabled={status === "loading"}
            className="btn-primary !px-3 !py-1.5 text-sm disabled:opacity-60"
          >
            <Locate className="h-4 w-4" /> {status === "loading" ? t("locating") : t("useMyLocation")}
          </button>
          <span className="text-sm text-slate-500">{t("privacyNote")}</span>
          {status === "error" && (
            <span className="text-sm font-medium text-amber-600" role="status">
              {t("locationError")}
            </span>
          )}
        </div>
      )}
      {ranked.length === 0 ? (
        <p className="card p-6 text-slate-500">{t("noData")}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ranked.map((v) => (
            <VenueCard key={v.id} v={v} />
          ))}
        </div>
      )}
    </div>
  );
}
