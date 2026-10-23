import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";

const schema = z.object({ action: z.enum(["approve", "reject"]) });
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Chỉ Admin" }, { status: 403 });
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  const status = parsed.data.action === "approve" ? "APPROVED" : "REJECTED";
  const venue = await prisma.venue.update({ where: { id }, data: { status, verified: status === "APPROVED" } });
  await prisma.auditLog.create({ data: { actorId: user.id, action: `VENUE_${status}`, entity: "Venue", entityId: id, details: venue.name } });
  await notify(venue.ownerId, "VENUE", `Sân ${venue.name} — ${status === "APPROVED" ? "đã được duyệt" : "bị từ chối"}`, `Trạng thái mới: ${status}`, id, `venue-${id}-${status}`);
  return NextResponse.json({ venue });
}
