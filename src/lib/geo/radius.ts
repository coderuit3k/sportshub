/**
 * Radius search over venues — "sân trong bán kính 5km" — backed by
 * PostGIS (see prisma/postgis.ts and docs/geo-radius.md).
 *
 * The geography point is computed INLINE from the venue's current
 * latitude/longitude on every query (ST_MakePoint → geography), so
 * results can never be stale and `prisma db push` never has to manage
 * a geography column. Only the `postgis` extension is required; on
 * the SQLite development database the query fails, and the error is
 * wrapped with that context instead of surfacing a driver message.
 *
 * Only public (APPROVED) venues with coordinates can match: a venue
 * without coordinates is excluded by the WHERE clause, never treated
 * as distance 0.
 */
import type { PrismaClient } from "@prisma/client";

export interface VenueRadiusHit {
  venueId: string;
  slug: string;
  name: string;
  district: string;
  address: string;
  latitude: number;
  longitude: number;
  /** Exact great-circle distance on the geography spheroid, in km. */
  distanceKm: number;
  googleRating: number | null;
  googleRatingCount: number | null;
  ratingAvg: number;
  ratingCount: number;
}

export interface RadiusQuery {
  lat: number;
  lng: number;
  /** Search radius in kilometres; (0, 100]. */
  radiusKm: number;
  /** Optional canonical sport slug filter (e.g. "cau-long"). */
  sportSlug?: string;
  /** Result cap; clamped to [1, 50]. Default 20. */
  limit?: number;
}

export async function findVenuesWithinRadius(
  db: PrismaClient,
  query: RadiusQuery,
): Promise<VenueRadiusHit[]> {
  const { lat, lng, radiusKm } = query;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RangeError(`lat must be within [-90, 90], got ${lat}`);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new RangeError(`lng must be within [-180, 180], got ${lng}`);
  }
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 100) {
    throw new RangeError(`radiusKm must be within (0, 100], got ${radiusKm}`);
  }
  const limit = Math.min(50, Math.max(1, Math.trunc(query.limit ?? 20)));
  const radiusMeters = radiusKm * 1000;

  // Positional parameters throughout — every value (including the
  // optional sport slug) is bound, never interpolated. (Prisma.sql
  // fragment reuse mis-numbers placeholders when the same fragment is
  // interpolated twice, hence the explicit $n form.)
  const params: unknown[] = [lng, lat, radiusMeters];
  let sportClause = "";
  if (query.sportSlug) {
    params.push(query.sportSlug);
    sportClause = `AND EXISTS (
        SELECT 1 FROM "VenueSport" vs
          JOIN "Sport" s ON s.id = vs."sportId"
         WHERE vs."venueId" = v.id AND s.slug = $${params.length}
      )`;
  }
  params.push(limit);
  const sql = `
    SELECT v.id AS "venueId", v.slug, v.name, v.district, v.address,
           v.latitude, v.longitude,
           public.ST_Distance(public.ST_SetSRID(public.ST_MakePoint(v.longitude, v.latitude), 4326)::public.geography,
                       public.ST_SetSRID(public.ST_MakePoint($1, $2), 4326)::public.geography) / 1000.0 AS "distanceKm",
           v."googleRating", v."googleRatingCount", v."ratingAvg", v."ratingCount"
      FROM "Venue" v
     WHERE v.status = 'APPROVED'
       AND v.latitude IS NOT NULL
       AND v.longitude IS NOT NULL
       AND public.ST_DWithin(public.ST_SetSRID(public.ST_MakePoint(v.longitude, v.latitude), 4326)::public.geography,
                      public.ST_SetSRID(public.ST_MakePoint($1, $2), 4326)::public.geography, $3)
       ${sportClause}
     ORDER BY "distanceKm" ASC
     LIMIT $${params.length}
  `;

  try {
    return await db.$queryRawUnsafe<VenueRadiusHit[]>(sql, ...params);
  } catch (e) {
    throw new Error(
      "findVenuesWithinRadius requires PostgreSQL with PostGIS set up " +
        "(run `npm run db:postgis` against the PostgreSQL database — see docs/geo-radius.md). " +
        `Original error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
