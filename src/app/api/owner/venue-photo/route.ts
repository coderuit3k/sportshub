import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { genericWriteLimiter, tooManyRequests } from "@/lib/rate-limit";
import { VENUES_TAG } from "@/lib/public-data";
import { getVenueForManager } from "@/lib/venue-photos/access";
import {
  getR2Client,
  getR2Config,
  isStoredPhotoUrl,
  storageKeyFromUrl,
} from "@/lib/storage/r2";

/**
 * Persist / remove a venue's stored primary photo (Cloudflare R2).
 *
 * DELETE { venueId } — reverts the primary row to the `gradient:*`
 * placeholder, i.e. back to the code-map default photo, and deletes
 * the R2 object best-effort.
 *
 * POST { venueId, photoUrl } — after the browser has uploaded the
 * photo directly to R2 (presign route: /api/owner/venue-photo/
 * upload), this records the URL on the venue's primary VenueImage
 * row, which makes it the displayed photo (display priority #1).
 * The URL is re-validated here — it must live under OUR bucket's
 * public base (R2_PUBLIC_BASE_URL) — and ownership is re-verified,
 * never trusting the upload step.
 *
 * Both verbs are authenticated writes claimed by the generic write
 * bucket (60 / 10 min / user) — see tests/rate-limit-coverage.test.ts.
 */

const persistSchema = z.object({
  venueId: z.string().min(1),
  photoUrl: z.string().url(),
});
const removeSchema = z.object({ venueId: z.string().min(1) });

const PLACEHOLDER_URL = "gradient:green";

async function primaryImageRow(venueId: string) {
  return prisma.venueImage.findFirst({
    where: { venueId },
    orderBy: { sortOrder: "asc" },
  });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  const gate = await genericWriteLimiter.consume(`write:${user.id}`);
  if (!gate.allowed) return tooManyRequests(gate);
  const parsed = removeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  const { venueId } = parsed.data;
  const access = await getVenueForManager(prisma, user, venueId);
  if (!access) return NextResponse.json({ error: "Không tìm thấy sân" }, { status: 404 });
  if (!access.allowed) return NextResponse.json({ error: "Bạn không có quyền quản lý sân này" }, { status: 403 });
  const primary = await primaryImageRow(venueId);
  if (primary && primary.url !== PLACEHOLDER_URL) {
    const oldUrl = primary.url;
    await prisma.venueImage.update({ where: { id: primary.id }, data: { url: PLACEHOLDER_URL } });
    const config = getR2Config();
    const key = config ? storageKeyFromUrl(oldUrl) : null;
    if (config && key) {
      // Best-effort: the row already reverted, so a failed delete
      // only leaves an orphaned object in the bucket, never bad data.
      try {
        await getR2Client(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch (error) {
        console.error(`[venue-photo] failed to delete R2 object ${key}:`, error);
      }
    }
  }
  revalidateTag(VENUES_TAG, { expire: 0 });
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  const gate = await genericWriteLimiter.consume(`write:${user.id}`);
  if (!gate.allowed) return tooManyRequests(gate);
  const parsed = persistSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  const { venueId, photoUrl } = parsed.data;
  const access = await getVenueForManager(prisma, user, venueId);
  if (!access) return NextResponse.json({ error: "Không tìm thấy sân" }, { status: 404 });
  if (!access.allowed) return NextResponse.json({ error: "Bạn không có quyền quản lý sân này" }, { status: 403 });
  if (!isStoredPhotoUrl(photoUrl)) {
    return NextResponse.json(
      { error: "URL ảnh không thuộc kho lưu trữ của SportsHub" },
      { status: 400 },
    );
  }
  const primary = await primaryImageRow(venueId);
  if (primary) {
    await prisma.venueImage.update({ where: { id: primary.id }, data: { url: photoUrl } });
  } else {
    await prisma.venueImage.create({
      data: { venueId, url: photoUrl, caption: access.venue.name, sortOrder: 0 },
    });
  }
  revalidateTag(VENUES_TAG, { expire: 0 });
  return NextResponse.json({ ok: true, imageUrl: photoUrl });
}
