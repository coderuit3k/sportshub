import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { VENUES_TAG } from "@/lib/public-data";
import { genericWriteLimiter, tooManyRequests } from "@/lib/rate-limit";

const schema = z.object({ action: z.enum(["approve", "reject"]) });
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Chỉ Admin" }, { status: 403 });
  // Admin mutations are NOT exempt from rate limiting: generic write bucket.
  const gate = await genericWriteLimiter.consume(`write:${user.id}`);
  if (!gate.allowed) return tooManyRequests(gate);
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  const status = parsed.data.action === "approve" ? "APPROVED" : "REJECTED";
  const venue = await prisma.venue.update({ where: { id }, data: { status, verified: status === "APPROVED" } });
  // The venue's public visibility just changed: drop every cached public
  // payload carrying venue data (home, list, this venue's detail) instead
  // of waiting out the TTL. See src/lib/public-data.ts.
  revalidateTag(VENUES_TAG);
  revalidatePath("/");
  revalidatePath("/venues");
  revalidatePath(`/venues/${venue.slug}`);
  await prisma.auditLog.create({ data: { actorId: user.id, action: `VENUE_${status}`, entity: "Venue", entityId: id, details: venue.name } });
  await notify(venue.ownerId, "VENUE", `Sân ${venue.name} — ${status === "APPROVED" ? "đã được duyệt" : "bị từ chối"}`, `Trạng thái mới: ${status}`, id, `venue-${id}-${status}`);
  return NextResponse.json({ venue });
}
