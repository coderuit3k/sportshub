/**
 * Geolocation ranking for the homepage "Sân nổi bật" (featured venues).
 *
 * Ranking criteria, in strict priority order (owner's spec):
 *   1. star rating (ratingAvg, descending)
 *   2. distance from the user's position (ascending; only when a position
 *      is known — venues without coordinates count as infinitely far)
 *   3. price (minPrice, ascending; venues without a price count as
 *      infinitely expensive)
 *
 * Everything here is pure and client-safe: the user's coordinates are
 * handled in the browser only and are never sent to the server.
 */

export interface RankableVenue {
  ratingAvg: number;
  minPrice: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface UserPosition {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two coordinates, in kilometres. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Rank venues by rating → distance → price (see header). Returns a NEW
 * array of shallow copies augmented with `distanceKm` (null when the user
 * position or the venue coordinates are unknown); the input array and its
 * items are never mutated. The sort is stable: venues that tie on every
 * criterion keep their input order.
 */
export function rankVenues<T extends RankableVenue>(
  venues: T[],
  userPos: UserPosition | null,
): Array<T & { distanceKm: number | null }> {
  const withDistance = venues.map((v) => ({
    ...v,
    distanceKm:
      userPos && v.latitude != null && v.longitude != null
        ? haversineKm(userPos.lat, userPos.lng, v.latitude, v.longitude)
        : null,
  }));
  return withDistance
    .map((v, index) => ({ v, index }))
    .sort((a, b) => {
      // 1. rating, descending
      if (b.v.ratingAvg !== a.v.ratingAvg) return b.v.ratingAvg - a.v.ratingAvg;
      // 2. distance, ascending (unknown distance = +Infinity)
      const da = a.v.distanceKm ?? Number.POSITIVE_INFINITY;
      const db = b.v.distanceKm ?? Number.POSITIVE_INFINITY;
      if (db !== da) return da - db;
      // 3. price, ascending (unknown price = +Infinity)
      const pa = a.v.minPrice ?? Number.POSITIVE_INFINITY;
      const pb = b.v.minPrice ?? Number.POSITIVE_INFINITY;
      if (pb !== pa) return pa - pb;
      // stable: keep input order on a full tie
      return a.index - b.index;
    })
    .map(({ v }) => v);
}

/**
 * Human-readable distance, following the active locale:
 *   < 1 km  → whole metres, e.g. "850 m" (both locales)
 *   < 10 km → one decimal, e.g. "2,3 km" (vi) / "2.3 km" (en)
 *   ≥ 10 km → whole kilometres, e.g. "13 km"
 * Defaults to vi so existing callers/tests are unchanged.
 */
export function formatDistance(km: number, locale = "vi"): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) {
    const fixed = km.toFixed(1);
    return `${locale.startsWith("en") ? fixed : fixed.replace(".", ",")} km`;
  }
  return `${Math.round(km)} km`;
}
