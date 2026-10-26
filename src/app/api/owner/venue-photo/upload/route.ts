import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getVenueForManager } from "@/lib/venue-photos/access";
import {
  STORAGE_NOT_CONFIGURED_CODE,
  STORAGE_NOT_CONFIGURED_MESSAGE,
  getR2Client,
  getR2Config,
  ownerUploadKey,
  publicUrlForKey,
} from "@/lib/storage/r2";
import {
  VENUE_PHOTO_CONTENT_TYPES,
  VENUE_PHOTO_MAX_BYTES,
} from "@/lib/venue-photos/policy";

/**
 * Presign route for venue-photo uploads (Cloudflare R2).
 *
 * POST { venueId, contentType, size } → verifies the session user
 * manages the venue (owner / staff / ADMIN — the same rule as the
 * persist route), validates the declared type (JPEG/PNG/WebP) and
 * size (≤ 8 MB), and returns a presigned PutObject URL (300 s
 * expiry). The browser then PUTs the file bytes DIRECTLY to R2 — no
 * file ever passes through this server — and reports the resulting
 * publicUrl to POST /api/owner/venue-photo, which persists it.
 *
 * This route performs no write itself, so for rate limiting it is
 * covered by the global per-IP net only (see
 * tests/rate-limit-coverage.test.ts).
 *
 * While R2 is not configured (the owner connects the bucket after
 * this code deploys) the route answers 503 with code
 * STORAGE_NOT_CONFIGURED so the UI shows its explanatory disabled
 * state instead of a generic failure.
 */

const presignSchema = z.object({
  venueId: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
});

const PRESIGN_EXPIRY_SECONDS = 300;

export async function POST(req: Request) {
  const config = getR2Config();
  if (!config) {
    return NextResponse.json(
      { error: STORAGE_NOT_CONFIGURED_MESSAGE, code: STORAGE_NOT_CONFIGURED_CODE },
      { status: 503 },
    );
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  const parsed = presignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  const { venueId, contentType, size } = parsed.data;
  const access = await getVenueForManager(prisma, user, venueId);
  if (!access) return NextResponse.json({ error: "Không tìm thấy sân" }, { status: 404 });
  if (!access.allowed) {
    return NextResponse.json({ error: "Bạn không có quyền quản lý sân này" }, { status: 403 });
  }
  if (!VENUE_PHOTO_CONTENT_TYPES.includes(contentType)) {
    return NextResponse.json(
      { error: "Chỉ chấp nhận ảnh định dạng JPEG, PNG hoặc WebP." },
      { status: 400 },
    );
  }
  if (size > VENUE_PHOTO_MAX_BYTES) {
    return NextResponse.json({ error: "Ảnh tối đa 8 MB." }, { status: 400 });
  }
  const key = ownerUploadKey(access.venue.slug, contentType, Date.now());
  const uploadUrl = await getSignedUrl(
    getR2Client(config),
    new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS },
  );
  return NextResponse.json({ uploadUrl, publicUrl: publicUrlForKey(config, key), key });
}
