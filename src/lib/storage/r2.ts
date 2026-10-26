import { S3Client } from "@aws-sdk/client-s3";
import { VENUE_PHOTO_EXTENSIONS } from "@/lib/venue-photos/policy";

/**
 * Cloudflare R2 image storage — the one shared client module.
 *
 * Venue photos live in a dedicated R2 bucket (S3-compatible; setup
 * checklist in docs/architecture.md → "Image storage"). Configuration
 * is the presence of ALL five env vars:
 *
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_BUCKET, R2_PUBLIC_BASE_URL
 *
 * (set in the Vercel project by the owner — never in code or chat).
 * While any of them is missing, storage is "not configured" and every
 * consumer degrades gracefully: the deploy-time photo migration logs
 * a skip and succeeds, the owner upload UI shows its disabled state,
 * and photos keep displaying from the code map
 * (src/lib/venue-images.ts) exactly as before this layer existed.
 */

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public base URL of the bucket (r2.dev subdomain), no trailing slash. */
  publicBaseUrl: string;
}

/** The five env vars that together configure R2 storage. */
export const R2_ENV_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
] as const;

/** Error code the photo routes return while storage is not configured. */
export const STORAGE_NOT_CONFIGURED_CODE = "STORAGE_NOT_CONFIGURED";

export const STORAGE_NOT_CONFIGURED_MESSAGE =
  "Kho lưu trữ ảnh chưa được bật cho SportsHub (chưa kết nối Cloudflare R2).";

/** Full config, or null when any required env var is missing/empty. */
export function getR2Config(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  const publicBaseUrl = env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

/** True when all five R2 env vars are present. */
export function isStorageConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getR2Config(env) !== null;
}

let cachedClient: { accountId: string; client: S3Client } | null = null;

/**
 * Shared S3 client pointed at the R2 endpoint. Callers must check
 * isStorageConfigured()/getR2Config() first — this throws when the
 * config is absent so a programming error surfaces loudly instead of
 * silently talking to the wrong endpoint.
 */
export function getR2Client(config: R2Config | null = getR2Config()): S3Client {
  if (!config) throw new Error("R2 storage is not configured (missing R2_* env vars)");
  if (cachedClient?.accountId !== config.accountId) {
    cachedClient = {
      accountId: config.accountId,
      client: new S3Client({
        region: "auto",
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      }),
    };
  }
  return cachedClient.client;
}

/** Storage key of the migrated curated photo for a venue. */
export function venuePhotoKey(venueSlug: string): string {
  return `venue-photos/${venueSlug}.jpg`;
}

/** Storage key for an owner upload (timestamped, extension by content type). */
export function ownerUploadKey(venueSlug: string, contentType: string, timestamp: number): string {
  const ext = VENUE_PHOTO_EXTENSIONS[contentType] ?? "jpg";
  return `venue-photos/${venueSlug}-${timestamp}.${ext}`;
}

/** Public URL for a storage key under the configured public base. */
export function publicUrlForKey(config: R2Config, key: string): string {
  return `${config.publicBaseUrl}/${key}`;
}

/**
 * True when `url` lives under OUR R2 public base — the only URLs the
 * persist route accepts as stored venue photos. False while storage
 * is unconfigured (no base to trust).
 */
export function isStoredPhotoUrl(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const config = getR2Config(env);
  if (!config) return false;
  try {
    const parsed = new URL(url);
    const base = new URL(config.publicBaseUrl);
    return parsed.protocol === "https:" && parsed.origin === base.origin && parsed.pathname.startsWith(`${base.pathname.replace(/\/+$/, "")}/`);
  } catch {
    return false;
  }
}

/** The storage key behind a stored photo URL, or null when it isn't ours. */
export function storageKeyFromUrl(url: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const config = getR2Config(env);
  if (!config || !isStoredPhotoUrl(url, env)) return null;
  const base = new URL(config.publicBaseUrl);
  const prefix = `${base.pathname.replace(/\/+$/, "")}/`;
  return decodeURIComponent(new URL(url).pathname.slice(prefix.length));
}
