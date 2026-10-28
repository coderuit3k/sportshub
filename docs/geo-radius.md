# Radius search with PostGIS — "sân trong bán kính 5km"

SportsHub stores venue coordinates as plain `latitude`/`longitude`
columns. On **PostgreSQL** with the **PostGIS** extension, true
radius queries run directly over them:

```sql
SELECT name, district,
       ST_Distance(
         ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
         ST_SetSRID(ST_MakePoint(106.7553, 10.8503), 4326)::geography) / 1000 AS distance_km
  FROM "Venue"
 WHERE status = 'APPROVED'
   AND latitude IS NOT NULL AND longitude IS NOT NULL
   AND ST_DWithin(
         ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
         ST_SetSRID(ST_MakePoint(106.7553, 10.8503), 4326)::geography, 5000)
 ORDER BY distance_km;
```

(Longitude first in `ST_MakePoint(x, y)`; the radius in `ST_DWithin`
is in **metres** because the points are `geography`. The point above
is the centre of TP. Thủ Đức.)

## Design: extension only, point computed inline

The geography point is computed from `latitude`/`longitude` **at
query time**. There is deliberately no stored geography column:

- Nothing can drift or go stale — the point always reflects the
  venue's current coordinates.
- `prisma db push` never has to manage a geography column. (A stored
  GENERATED column was evaluated and rejected: db push fails against
  it — PostgreSQL refuses Prisma's reconcile step on generated
  columns — and a plain stored column would need syncing on every
  write path.)
- Setup is a single idempotent statement:
  `CREATE EXTENSION IF NOT EXISTS postgis`, wrapped by
  `prisma/postgis.ts` (`ensurePostgis`). It runs on every production
  deploy (deploy-db step 7, best-effort — a PostGIS problem never
  fails the build) and locally via `npm run db:postgis`.

Trade-off: `ST_DWithin` cannot use a GiST index over a computed
expression, so the query is a sequential scan computing spheroid
distances per row. At this catalog's scale (hundreds of venues) that
is milliseconds. If the catalog ever grows by orders of magnitude,
the upgrade path is a migration-managed generated column + GiST
index (Prisma migrations — not db push).

Code entry point: `src/lib/geo/radius.ts`
(`findVenuesWithinRadius`) — a parameter-bound raw query with input
validation; only `APPROVED` venues with coordinates can match. The
SQLite development database has no PostGIS; radius search is
PostgreSQL-only by design.

## Run it locally after cloning

You need a PostgreSQL server **with the PostGIS package available**
(Debian/Ubuntu: `postgresql-16-postgis-3`; Neon and most hosted
PostgreSQL include it). The local checkout must also use the
PostgreSQL Prisma client/schemas (the same switch the production
build performs):

```bash
export DATABASE_URL=postgresql://user:pass@localhost:5432/sportshub

npx prisma generate --schema prisma/schema.postgresql.prisma
npx prisma db push   --schema prisma/schema.postgresql.prisma
npm run db:seed        # demo data (skip if the database already has data)
npm run db:postgis     # CREATE EXTENSION postgis + status report

# "venues within 5 km" of TP. Thủ Đức centre:
npm run venues:near -- --lat 10.8503 --lng 106.7553 --radius 5

# filter by sport, widen the net:
npm run venues:near -- --lat 10.8503 --lng 106.7553 --radius 10 --sport cau-long
```

From code:

```ts
import { findVenuesWithinRadius } from "@/lib/geo/radius";

const hits = await findVenuesWithinRadius(prisma, {
  lat: 10.8503, lng: 106.7553, radiusKm: 5, sportSlug: "cau-long", limit: 20,
});
// → [{ name, district, distanceKm, googleRating, … }] ordered by distance
```

## Notes and limits

- Distances are exact spheroid distances from PostGIS `geography`
  (metres ÷ 1000), not the flat-earth approximation the in-app
  haversine ranking uses for display ordering.
- Only `APPROVED` venues with coordinates are returned.
- Production (Neon) supports PostGIS; the extension is enabled by
  deploy-db on the next deploy after this change. Until then,
  `npm run db:postgis` with the production `DATABASE_URL` does the
  same job manually.
- Verification: `tests/geo/radius.pg.test.ts` (PostgreSQL-gated,
  like the AI PG tests) exercises the extension install, the radius
  boundaries (a ≈4.9 km venue is inside 5 km but outside 4 km),
  ordering, the sport filter and coordinate freshness against a
  throwaway database:

  ```bash
  GEO_TEST_PG_URL=postgresql://sportshub_test:testpass@localhost:5432/ai_test \
    npx vitest run tests/geo/radius.pg.test.ts
  ```
