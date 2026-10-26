"use client";

import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
// Leaflet's default marker artwork: the CSS-relative image URLs break
// under a bundler, so hand the icon the emitted asset URLs explicitly.
// These static imports live in this lazy chunk only (see
// VenueDetailMapSection).
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

/**
 * Single-venue map for the detail page: plain Leaflet over OpenStreetMap
 * RASTER tiles — deliberately not the openstreetmap.org embed iframe,
 * whose current viewer is WebGL-based (MapLibre GL) and renders an error
 * box on machines without WebGL (e.g. RDP sessions). Raster tiles need
 * no WebGL. Scroll-wheel zoom is disabled so the map never traps page
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
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: markerIcon2x.src,
        iconUrl: markerIcon.src,
        shadowUrl: markerShadow.src,
      });
      map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([latitude, longitude], 15);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      L.marker([latitude, longitude]).addTo(map);
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
