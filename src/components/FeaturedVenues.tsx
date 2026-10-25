"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import VenueCard, { type VenueCardData } from "@/components/VenueCard";
import { rankVenues, type UserPosition } from "@/lib/geo/rank";

/**
 * Homepage "Sân nổi bật" (featured venues) with browser geolocation.
 *
 * Ranking (see src/lib/geo/rank.ts): rating → distance → price. The
 * server-rendered HTML already contains the full grid in the default
 * ranking (rating → price). On mount — and only on mount — the
 * component asks the browser for the visitor's position via the
 * Geolocation API, so the *device* shows its native permission
 * prompt; there is deliberately no in-page button. The position is
 * processed entirely on the client and never sent to the server.
 *
 * The location handling is fully silent: nothing in this section
 * reports the location state. Granted → the grid quietly re-ranks
 * and distance lines appear on the cards. Denied / timeout /
 * unsupported → the default ranking simply stays. While the browser
 * prompt is pending, the default-ranked grid renders as-is.
 *
 * The only copy this component renders itself is the empty-grid
 * message from the `home.featured` namespace (`noData`).
 */

export interface FeaturedVenueData extends VenueCardData {
  latitude: number | null;
  longitude: number | null;
}

export default function FeaturedVenues({ venues }: { venues: FeaturedVenueData[] }) {
  const t = useTranslations("home.featured");
  const [userPos, setUserPos] = useState<UserPosition | null>(null);
  const requestedRef = useRef(false);

  useEffect(() => {
    // Ask exactly once per mount, even under React StrictMode's
    // double-invoked effects during development.
    if (requestedRef.current) return;
    requestedRef.current = true;

    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        // Denied / timed out: stay silent — the default ranking stays.
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, []);

  const ranked = useMemo(() => rankVenues(venues, userPos), [venues, userPos]);

  return (
    <div>
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
