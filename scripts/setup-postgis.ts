/**
 * One-time (idempotent) PostGIS setup for a PostgreSQL database:
 * installs the `postgis` extension — the only database object radius
 * search needs (the geography point is computed inline at query
 * time; see prisma/postgis.ts) — then prints a status report. Safe
 * to re-run.
 *
 * Usage (the local checkout must use the PostgreSQL Prisma client —
 * see docs/geo-radius.md):
 *
 *   DATABASE_URL=postgresql://user:pass@localhost:5432/sportshub \
 *     npm run db:postgis
 */
import { PrismaClient } from "@prisma/client";
import { ensurePostgis } from "../prisma/postgis";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("postgres")) {
    console.error(
      "DATABASE_URL must point at PostgreSQL (PostGIS does not exist on the SQLite dev database).\n" +
        "Also make sure the generated Prisma client matches: " +
        "npx prisma generate --schema prisma/schema.postgresql.prisma",
    );
    process.exit(1);
  }
  const db = new PrismaClient();
  try {
    const status = await ensurePostgis(db);
    console.log("PostGIS setup complete:");
    console.log(`  extension installed   : ${status.extensionInstalled}`);
    console.log(`  venues with coordinates: ${status.venuesWithCoordinates}`);
    if (!status.extensionInstalled) {
      process.exit(1);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
