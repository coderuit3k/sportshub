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
 * - Granted → the grid re-ranks with distances on the cards and one
 *   plain-text status line appears above the grid.
 * - Denied / timeout / unsupported → the default ranking stays and
 *   one plain-text note explains why; the list never breaks.
 * - While the browser prompt is pending, the default-ranked grid
 *   renders with no extra UI (no spinner, no button).
 *
 * All UI copy comes from the `home.featured` message namespace.
 */

export interface FeaturedVenueData extends VenueCardData {
  latitude: number | null;
  longitude: number | null;
}

type GeoStatus = "pending" | "granted" | "error";

export default function FeaturedVenues({ venues }: { venues: FeaturedVenueData[] }) {
  const t = useTranslations("home.featured");
  const [userPos, setUserPos] = useState<UserPosition | null>(null);
  const [status, setStatus] = useState<GeoStatus>("pending");
  const requestedRef = useRef(false);

  useEffect(() => {
    // Ask exactly once per mount, even under React StrictMode's
    // double-invoked effects during development.
    if (requestedRef.current) return;
    requestedRef.current = true;

    if (!("geolocation" in navigator)) {
      setStatus("error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus("granted");
      },
      () => {
        setStatus("error");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, []);

  const ranked = useMemo(() => rankVenues(venues, userPos), [venues, userPos]);

  return (
    <div>
      {status === "granted" && (
        <p className="mb-4 text-sm text-slate-600" role="status">
          {t("rankedStatus")}
        </p>
      )}
      {status === "error" && (
        <p className="mb-4 text-sm font-medium text-amber-600" role="status">
          {t("locationError")}
        </p>
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
