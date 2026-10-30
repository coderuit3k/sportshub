/**
 * PostGIS setup for radius search ("venues within N km").
 *
 * Deliberately minimal: the ONLY database object radius search needs
 * is the `postgis` extension. The geography point is computed inline
 * from latitude/longitude at query time (src/lib/geo/radius.ts), so:
 *
 * - there is no geography column for `prisma db push` to manage —
 *   a GENERATED column actively breaks db push ("column is a
 *   generated column" when push tries to reconcile it), and a plain
 *   column could silently drift from the coordinates;
 * - the point can never be stale: it is derived from the venue's
 *   current latitude/longitude on every query;
 * - setup is one idempotent statement.
 *
 * The trade-off is that ST_DWithin cannot use a GiST index over a
 * computed expression — irrelevant at this catalog's scale (hundreds
 * of venues, sequential scan in milliseconds). If the catalog grows
 * by orders of magnitude, revisit with a migration-managed generated
 * column (Prisma migrations, not db push).
 *
 * Callers decide failure policy: production deploy wraps this in a
 * try/catch (a PostGIS problem must never fail the build), while the
 * local setup script lets it throw.
 */
import type { PrismaClient } from "@prisma/client";

export interface PostgisStatus {
  extensionInstalled: boolean;
  /** Venues that carry coordinates (the only ones a radius query can match). */
  venuesWithCoordinates: number;
}

export async function ensurePostgis(db: PrismaClient): Promise<PostgisStatus> {
  await db.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public");
  return postgisStatus(db);
}

export async function postgisStatus(db: PrismaClient): Promise<PostgisStatus> {
  const ext = await db.$queryRawUnsafe<Array<{ n: number }>>(
    "SELECT COUNT(*)::int AS n FROM pg_extension WHERE extname = 'postgis'",
  );
  const counted = await db.$queryRawUnsafe<Array<{ n: number }>>(
    'SELECT COUNT(*)::int AS n FROM "Venue" WHERE latitude IS NOT NULL AND longitude IS NOT NULL',
  );
  return {
    extensionInstalled: (ext[0]?.n ?? 0) > 0,
    venuesWithCoordinates: counted[0]?.n ?? 0,
  };
}
