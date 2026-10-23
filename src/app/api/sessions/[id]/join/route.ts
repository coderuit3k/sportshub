import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canJoinSession } from "@/lib/booking/logic";
import { notify } from "@/lib/notifications";

const schema = z.object({ action: z.enum(["join", "leave"]) });
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  const session = await prisma.sportsSession.findUnique({ where: { id }, include: { participants: true } });
  if (!session) return NextResponse.json({ error: "Không tìm thấy kèo" }, { status: 404 });

  if (parsed.data.action === "leave") {
    await prisma.sessionParticipant.deleteMany({ where: { sessionId: id, userId: user.id } });
    const count = await prisma.sessionParticipant.count({ where: { sessionId: id, status: "JOINED" } });
    if (session.status === "FULL" && count < session.maxParticipants) await prisma.sportsSession.update({ where: { id }, data: { status: "OPEN" } });
    return NextResponse.json({ joined: false });
  }
  // join — duplicate prevention via unique constraint + pre-check
  const already = session.participants.find((p) => p.userId === user.id && p.status === "JOINED");
  if (already) return NextResponse.json({ error: "Bạn đã tham gia kèo này rồi" }, { status: 409 });
  const joinedCount = session.participants.filter((p) => p.status === "JOINED").length;
  if (!canJoinSession(joinedCount, session.maxParticipants)) return NextResponse.json({ error: "Kèo đã đầy" }, { status: 409 });
  await prisma.$transaction(async (tx) => {
    await tx.sessionParticipant.upsert({
      where: { sessionId_userId: { sessionId: id, userId: user.id } },
      create: { sessionId: id, userId: user.id, status: "JOINED" },
      update: { status: "JOINED" },
    });
    if (joinedCount + 1 >= session.maxParticipants) await tx.sportsSession.update({ where: { id }, data: { status: "FULL" } });
  });
  await notify(session.organizerId, "SESSION", "Có người tham gia kèo", `${user.name} vừa tham gia: ${session.title}`, id, `join-${id}-${user.id}`);
  return NextResponse.json({ joined: true });
}
