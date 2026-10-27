"use client";

import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./google-maps.css";
import { GOOGLE_STYLE_TILE_ATTRIBUTION, GOOGLE_STYLE_TILE_URL, applyGoogleChrome, googlePinIcon } from "./google-maps-style";

/**
 * Single-venue map for the detail page: plain Leaflet over CARTO Voyager
 * RASTER tiles (OpenStreetMap data styled to look like Google Maps) —
 * deliberately not the openstreetmap.org embed iframe, whose current
 * viewer is WebGL-based (MapLibre GL) and renders an error box on
 * machines without WebGL (e.g. RDP sessions). Raster tiles need no
 * WebGL. Scroll-wheel zoom is disabled so the map never traps page
 * scrolling; dragging and the +/- zoom buttons still work.
 */
export default function VenueDetailMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | null = null;
    (async () => {
      const L = (await import("leaflet")) as unknown as typeof Leaflet;
      if (cancelled || !containerRef.current) return;
      map = L.map(containerRef.current, { scrollWheelZoom: false, zoomControl: false, attributionControl: false }).setView([latitude, longitude], 15);
      applyGoogleChrome(L, map);
      L.tileLayer(GOOGLE_STYLE_TILE_URL, {
        attribution: GOOGLE_STYLE_TILE_ATTRIBUTION,
        subdomains: "abcd",
        maxZoom: 20,
      }).addTo(map);
      L.marker([latitude, longitude], { icon: googlePinIcon(L) }).addTo(map);
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [latitude, longitude]);

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border">
      {/* z-0 keeps Leaflet's internal pane z-indexes in this stacking
          context, below the sticky site header (z-40). */}
      <div ref={containerRef} className="z-0 h-80 w-full" data-testid="venue-detail-map" />
    </div>
  );
}
