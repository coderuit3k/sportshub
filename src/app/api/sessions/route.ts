import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sessionCreateLimiter, tooManyRequests } from "@/lib/rate-limit";

const schema = z.object({
  title: z.string().min(5), sportId: z.string().min(1), venueId: z.string().optional(),
  startAt: z.string().datetime(), endAt: z.string().datetime(),
  skillLevel: z.enum(["ALL", "BEGINNER", "INTERMEDIATE", "ADVANCED"]).default("ALL"),
  maxParticipants: z.number().int().min(2).max(50), costPerPerson: z.number().int().min(0).default(0),
  description: z.string().optional(),
});
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  // Session spam brake: 10 creations per hour per user (specific bucket —
  // this route is NOT also counted into the generic write bucket).
  const gate = await sessionCreateLimiter.consume(`session-create:${user.id}`);
  if (!gate.allowed) return tooManyRequests(gate);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  const d = parsed.data;
  const session = await prisma.sportsSession.create({
    data: {
      title: d.title, sportId: d.sportId, venueId: d.venueId || null, organizerId: user.id,
      startAt: new Date(d.startAt), endAt: new Date(d.endAt), skillLevel: d.skillLevel,
      maxParticipants: d.maxParticipants, costPerPerson: d.costPerPerson, description: d.description,
    },
  });
  await prisma.sessionParticipant.create({ data: { sessionId: session.id, userId: user.id, status: "JOINED" } });
  return NextResponse.json({ session }, { status: 201 });
}
