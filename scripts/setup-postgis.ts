import { createPrismaClient } from "../src/lib/prisma-client";
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
import { ensurePostgis } from "../prisma/postgis";

// Load .env like the Prisma CLI does, so DATABASE_URL can live only
// in the file (previously this script required it exported in the
// shell and failed with a misleading message when it was not).
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the real environment.
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("postgres")) {
    console.error(
      "DATABASE_URL must point at PostgreSQL.\n" +
        "Also make sure the generated Prisma client matches: " +
        "npm run db:generate",
    );
    process.exit(1);
  }
  const db = createPrismaClient();
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
