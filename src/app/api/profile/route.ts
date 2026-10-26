import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { genericWriteLimiter, tooManyRequests } from "@/lib/rate-limit";
const schema = z.object({
  name: z.string().min(2).optional(),
  preferredDistrict: z.string().optional(),
  preferredTimeRange: z.string().optional(),
  sportIds: z.array(z.string()).optional(),
});
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  // Generic authenticated-write bucket: 60 writes per 10 minutes per user.
  const gate = await genericWriteLimiter.consume(`write:${user.id}`);
  if (!gate.allowed) return tooManyRequests(gate);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  const d = parsed.data;
  if (d.name) await prisma.user.update({ where: { id: user.id }, data: { name: d.name } });
  await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, preferredDistrict: d.preferredDistrict, preferredTimeRange: d.preferredTimeRange },
    update: { preferredDistrict: d.preferredDistrict, preferredTimeRange: d.preferredTimeRange },
  });
  if (d.sportIds) {
    await prisma.userSportPreference.deleteMany({ where: { userId: user.id } });
    for (const sportId of d.sportIds) await prisma.userSportPreference.create({ data: { userId: user.id, sportId } });
  }
  return NextResponse.json({ ok: true });
}
