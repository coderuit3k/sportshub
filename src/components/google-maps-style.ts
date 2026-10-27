import type * as Leaflet from "leaflet";

/**
 * Shared "Google Maps look" for the Leaflet maps: the closest free
 * raster match for Google's palette is CARTO Voyager (pale roads, muted
 * greens, blue water, soft labels) over OpenStreetMap data — attribution
 * to both is required by the tile terms. Pins are inline SVG teardrops
 * in Google red instead of Leaflet's blue default marker.
 */
export const GOOGLE_STYLE_TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
export const GOOGLE_STYLE_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42"><path d="M15 1C8.4 1 3 6.3 3 12.8 3 21.5 15 41 15 41s12-19.5 12-28.2C27 6.3 21.6 1 15 1z" fill="#EA4335" stroke="#B3261E" stroke-width="1"/><circle cx="15" cy="13" r="5.5" fill="#ffffff"/></svg>`;

/** A Google-Maps-style red teardrop pin as a Leaflet divIcon. */
export function googlePinIcon(L: typeof Leaflet): Leaflet.DivIcon {
  return L.divIcon({
    className: "google-pin-icon",
    html: PIN_SVG,
    iconSize: [30, 42],
    iconAnchor: [15, 42],
    popupAnchor: [0, -41],
  });
}

/**
 * Google-Maps-style chrome: zoom +/- docked bottom-right, attribution
 * small at bottom-left. Must run before the tile layer is added so the
 * layer's attribution registers into the repositioned control.
 */
export function applyGoogleChrome(L: typeof Leaflet, map: Leaflet.Map): void {
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control.attribution({ position: "bottomleft", prefix: false }).addTo(map);
}
