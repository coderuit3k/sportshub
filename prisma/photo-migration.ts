/**
 * Deploy-time migration: copy every venue's curated code-map photo
 * into the Cloudflare R2 bucket and store its public URL on the
 * venue's primary VenueImage row, so stored photos become the
 * primary display source (see src/lib/venue-images.ts →
 * resolveVenueDisplayImage, and docs/architecture.md → "Image
 * storage").
 *
 * Runs as a step of prisma/deploy-db.ts AFTER the catalog ensure.
 * The assignment source stays the code map (venueImage()): for each
 * venue whose assigned photo exists and whose primary row is
 * missing, a `gradient:*` placeholder, or not yet under our R2
 * public base, the photo is downloaded once (with our own site as
 * Referer, like the original verification) and PutObject'd to the
 * deterministic key `venue-photos/<venueSlug>.jpg` (same key every
 * run — re-runs converge instead of piling up copies). Idempotent:
 * once the primary row's URL starts with R2_PUBLIC_BASE_URL the
 * venue is skipped, so a second run migrates 0.
 *
 * FAILURE SEMANTICS — this step NEVER throws:
 * - R2 not configured (any of R2_ACCOUNT_ID / R2_ACCESS_KEY_ID /
 *   R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_BASE_URL missing —
 *   the owner connects the bucket after this code deploys): log a
 *   clear skip line and succeed; display keeps using the external
 *   code-map URLs exactly as before.
 * - A source download or an R2 upload fails for one venue: log it
 *   loudly, count it in the summary, and leave the row untouched —
 *   the external URL (or the code-map fallback) still displays, and
 *   the next build retries convergence.
 * Failing the build over a photo copy would punish deploys for a
 * purely cosmetic layer that has a working fallback at all times —
 * the opposite trade-off from the venue catalog itself, whose
 * absence would be a data loss.
 *
 * All HTTP/S3 work happens OUTSIDE any database transaction (the
 * catalog's TX_OPTIONS lesson: sequential cross-region round trips
 * inside a transaction are what the 60 s timeout protects against —
 * downloads don't belong in one at all). Each venue costs one small
 * row update after its upload completes.
 */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { PrismaClient } from "../src/generated/prisma/client";
import { venueImage } from "../src/lib/venue-images";
import {
  R2_ENV_VARS,
  getR2Client,
  getR2Config,
  publicUrlForKey,
  venuePhotoKey,
} from "../src/lib/storage/r2";

export interface PhotoMigrationDeps {
  /** Whether R2 storage is fully configured (all five env vars). */
  configured: boolean;
  /** Public base URL of the bucket; stored URLs start with this. */
  publicBaseUrl: string | null;
  fetchFn: typeof fetch;
  putFn: (key: string, body: Buffer, contentType: string) => Promise<{ url: string }>;
  /** Referer sent when downloading the source photos. */
  referer: string;
  log: (message: string) => void;
  errorLog: (message: string) => void;
}

export interface PhotoMigrationSummary {
  configured: boolean;
  migrated: number;
  skipped: number;
  failed: Array<{ slug: string; sourceUrl: string; error: string }>;
}

export function defaultPhotoMigrationDeps(): PhotoMigrationDeps {
  const config = getR2Config();
  return {
    configured: config !== null,
    publicBaseUrl: config?.publicBaseUrl ?? null,
    fetchFn: (url, init) => fetch(url, init),
    putFn: async (key, body, contentType) => {
      if (!config) throw new Error("R2 storage is not configured");
      await getR2Client(config).send(
        new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType }),
      );
      return { url: publicUrlForKey(config, key) };
    },
    referer: process.env.NEXT_PUBLIC_APP_URL ?? "https://sportshub-pi-five.vercel.app",
    log: (message) => console.log(message),
    errorLog: (message) => console.error(message),
  };
}

export async function migrateVenuePhotosToStorage(
  prisma: PrismaClient,
  deps: PhotoMigrationDeps = defaultPhotoMigrationDeps(),
): Promise<PhotoMigrationSummary> {
  const summary: PhotoMigrationSummary = { configured: deps.configured, migrated: 0, skipped: 0, failed: [] };
  if (!deps.configured || !deps.publicBaseUrl) {
    deps.log(
      `[photo-migration] R2 storage not configured (needs ${R2_ENV_VARS.join(", ")}) — ` +
        "skipping photo migration; venues keep displaying the external code-map photo URLs.",
    );
    return summary;
  }
  const storedPrefix = `${deps.publicBaseUrl}/`;

  try {
    const venues = await prisma.venue.findMany({
      include: {
        sports: { include: { sport: true } },
        images: { orderBy: { sortOrder: "asc" } },
      },
    });

    for (const venue of venues) {
      const assigned = venueImage(venue.sports[0]?.sport.slug ?? null, venue.slug);
      if (!assigned) {
        summary.skipped++;
        continue;
      }
      const primary = venue.images[0];
      if (primary && primary.url.startsWith(storedPrefix)) {
        summary.skipped++;
        continue;
      }
      try {
        const res = await deps.fetchFn(assigned, { headers: { Referer: deps.referer } });
        if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
        const contentType = res.headers.get("content-type") ?? "image/jpeg";
        const body = Buffer.from(await res.arrayBuffer());
        const stored = await deps.putFn(venuePhotoKey(venue.slug), body, contentType);
        if (primary) {
          await prisma.venueImage.update({ where: { id: primary.id }, data: { url: stored.url } });
        } else {
          await prisma.venueImage.create({
            data: { venueId: venue.id, url: stored.url, caption: venue.name, sortOrder: 0 },
          });
        }
        summary.migrated++;
        deps.log(`[photo-migration] ${venue.slug}: ${assigned} → ${stored.url}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.failed.push({ slug: venue.slug, sourceUrl: assigned, error: message });
        deps.errorLog(
          `[photo-migration] FAILED ${venue.slug} (${assigned}): ${message} — row left as-is, will retry next build`,
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.failed.push({ slug: "(migration)", sourceUrl: "", error: message });
    deps.errorLog(`[photo-migration] FAILED to run: ${message} — no rows changed by this step`);
  }

  deps.log(
    `[photo-migration] summary: migrated=${summary.migrated} skipped=${summary.skipped} failed=${summary.failed.length}`,
  );
  return summary;
}
