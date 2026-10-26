/**
 * Venue-photo upload policy — pure constants with NO imports, safe
 * to use from client components (the R2 client module
 * src/lib/storage/r2.ts pulls in the AWS SDK and must stay
 * server-side).
 */

/** Content types a venue owner may upload as a venue photo. */
export const VENUE_PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Maximum venue-photo upload size: 8 MB. */
export const VENUE_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

/** File extension per uploadable content type. */
export const VENUE_PHOTO_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
