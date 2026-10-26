import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { transitionBooking } from "@/services/bookings";
import { genericWriteLimiter, tooManyRequests } from "@/lib/rate-limit";

const schema = z.object({ action: z.enum(["cancel", "approve", "reject", "complete"]) });
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  // Generic authenticated-write bucket (booking creation has its own
  // stricter bucket; actions like cancel/approve land here).
  const gate = await genericWriteLimiter.consume(`write:${user.id}`);
  if (!gate.allowed) return tooManyRequests(gate);
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  const booking = await prisma.booking.findUnique({ where: { id }, include: { venue: true } });
  if (!booking) return NextResponse.json({ error: "Không tìm thấy đặt sân" }, { status: 404 });

  const action = parsed.data.action;
  // Server-side authorization per action
  if (action === "cancel" && booking.userId !== user.id && booking.venue.ownerId !== user.id && user.role !== "ADMIN")
    return NextResponse.json({ error: "Không có quyền hủy đặt này" }, { status: 403 });
  if ((action === "approve" || action === "reject") && booking.venue.ownerId !== user.id && user.role !== "ADMIN")
    return NextResponse.json({ error: "Chỉ chủ sân / admin mới duyệt được" }, { status: 403 });
  if (action === "complete" && booking.venue.ownerId !== user.id && user.role !== "ADMIN")
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });

  const to = { cancel: "CANCELLED", approve: "CONFIRMED", reject: "REJECTED", complete: "COMPLETED" }[action];
  try {
    const updated = await transitionBooking(id, to, user.id, `action:${action}`);
    if (action === "approve" || action === "reject") {
      await prisma.auditLog.create({ data: { actorId: user.id, action: `BOOKING_${to}`, entity: "Booking", entityId: id } });
    }
    return NextResponse.json({ booking: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lỗi" }, { status: 400 });
  }
}
