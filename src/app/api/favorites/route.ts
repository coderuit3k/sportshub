import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
const schema = z.object({ venueId: z.string().min(1) });
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  const existing = await prisma.favorite.findUnique({ where: { userId_venueId: { userId: user.id, venueId: parsed.data.venueId } } });
  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    return NextResponse.json({ favorite: false });
  }
  await prisma.favorite.create({ data: { userId: user.id, venueId: parsed.data.venueId } });
  return NextResponse.json({ favorite: true });
}
