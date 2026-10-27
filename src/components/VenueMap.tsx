"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
// Leaflet's default marker artwork: the CSS-relative image URLs break
// under a bundler, so hand the icon the emitted asset URLs explicitly.
// These static imports live in this lazy chunk only (see VenueMapSection).
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { formatVND } from "@/lib/booking/logic";
import { sportName } from "@/i18n/vocab";
import type { VenueMapPoint } from "@/lib/public-data";

/** Ho Chi Minh City center — the fallback view when no pins are showing. */
const HCMC_CENTER: [number, number] = [10.7769, 106.7009];

interface PopupLabels {
  sportLabel: (point: VenueMapPoint) => string;
  ratingLine: (point: VenueMapPoint) => string;
  priceLine: (point: VenueMapPoint) => string;
  viewAndBook: string;
}

/** Popup content built with DOM APIs (never innerHTML): venue names are
 * owner-supplied text and must not become markup. */
function buildPopupContent(L: typeof Leaflet, point: VenueMapPoint, labels: PopupLabels): HTMLElement {
  const root = document.createElement("div");
  root.style.minWidth = "180px";

  const title = document.createElement("strong");
  title.textContent = point.name;
  title.style.display = "block";
  title.style.fontSize = "14px";
  title.style.marginBottom = "2px";
  root.appendChild(title);

  const meta = document.createElement("div");
  meta.textContent = `${labels.sportLabel(point)} — ${point.district}`;
  meta.style.color = "#64748b";
  meta.style.fontSize = "12px";
  root.appendChild(meta);

  const rating = document.createElement("div");
  rating.textContent = labels.ratingLine(point);
  rating.style.fontSize = "13px";
  rating.style.marginTop = "4px";
  root.appendChild(rating);

  const price = document.createElement("div");
  price.textContent = labels.priceLine(point);
  price.style.fontSize = "13px";
  price.style.fontWeight = "600";
  price.style.color = "#0f5132";
  root.appendChild(price);

  const link = document.createElement("a");
  link.href = `/venues/${point.slug}`;
  link.textContent = labels.viewAndBook;
  link.style.display = "inline-block";
  link.style.marginTop = "6px";
  link.style.fontSize = "13px";
  link.style.fontWeight = "600";
  link.style.color = "#0f5132";
  root.appendChild(link);

  return root;
}

export default function VenueMap({ points }: { points: VenueMapPoint[] }) {
  const t = useTranslations("venues");
  const tCommon = useTranslations("common");
  const tSports = useTranslations("sports");
  const locale = useLocale();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markersRef = useRef<Leaflet.LayerGroup | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const labels: PopupLabels = useMemo(
    () => ({
      sportLabel: (point) =>
        point.primarySportSlug && point.sportName
          ? sportName((k) => tSports(k), point.primarySportSlug, point.sportName)
          : tCommon("sportFallback"),
      ratingLine: (point) =>
        point.googleRating != null
          ? `★ ${point.googleRating.toFixed(1)} ${tCommon("reviewsCount", { count: point.googleRatingCount ?? 0 })} · ${tCommon("googleReviews")}`
          : point.ratingAvg > 0
            ? `★ ${point.ratingAvg.toFixed(1)} ${tCommon("reviewsCount", { count: point.ratingCount })}`
            : tCommon("newVenue"),
      priceLine: (point) =>
        point.minPrice != null ? tCommon("priceFrom", { price: formatVND(point.minPrice, locale) }) : tCommon("priceOnRequest"),
      viewAndBook: tCommon("viewAndBook"),
    }),
    [tCommon, tSports, locale],
  );
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  // Initialize the map once, on mount. Leaflet itself is imported lazily
  // here (on top of this component being a lazy chunk), so nothing of it
  // loads for visitors who never open the map view.
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
      map = L.map(containerRef.current).setView(HCMC_CENTER, 11);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      leafletRef.current = L;
      mapRef.current = map;
      markersRef.current = L.layerGroup().addTo(map);
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markersRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  // (Re)draw the pins whenever the filtered dataset changes: one marker
  // per point, bounds fitted to the pins, HCMC fallback when empty.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const markers = markersRef.current;
    if (!mapReady || !L || !map || !markers) return;
    markers.clearLayers();
    for (const point of points) {
      const marker = L.marker([point.latitude, point.longitude]);
      marker.bindPopup(buildPopupContent(L, point, labelsRef.current));
      marker.addTo(markers);
    }
    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 14);
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number])), { padding: [28, 28] });
    } else {
      map.setView(HCMC_CENTER, 11);
    }
  }, [points, mapReady]);

  return (
    <div>
      <div className="card">
        {/* z-0 keeps Leaflet's internal pane z-indexes in this stacking
            context, below the sticky site header (z-40). */}
        <div ref={containerRef} className="z-0 h-[520px] w-full" data-testid="venue-map" />
      </div>
      {points.length === 0 && <p className="mt-3 text-sm text-slate-500">{t("mapEmpty")}</p>}
    </div>
  );
}
