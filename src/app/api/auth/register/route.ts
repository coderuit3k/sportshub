import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { getClientIp, registerLimiter, tooManyRequests } from "@/lib/rate-limit";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["PLAYER", "OWNER"]).default("PLAYER"),
});
export async function POST(req: Request) {
  const gate = await registerLimiter.consume(`register:${getClientIp(req)}`);
  if (!gate.allowed) return tooManyRequests(gate);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Dữ liệu không hợp lệ (mật khẩu tối thiểu 8 ký tự)" }, { status: 400 });
  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (exists)
    return NextResponse.json({ error: "Email đã được đăng ký" }, { status: 409 });
  const user = await prisma.user.create({
    data: { name: parsed.data.name, email: parsed.data.email, passwordHash: await bcrypt.hash(parsed.data.password, 10), role: parsed.data.role },
  });
  await prisma.userPreference.create({ data: { userId: user.id } });
  await setSessionCookie(await createSessionToken(user.id, user.role));
  return NextResponse.json({ id: user.id, role: user.role });
}
