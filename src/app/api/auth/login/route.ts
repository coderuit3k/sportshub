import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSessionToken, setSessionCookie } from "@/lib/auth";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "Email hoặc mật khẩu không đúng" }, { status: 401 });
  }
  if (user.status !== "ACTIVE") return NextResponse.json({ error: "Tài khoản đã bị khóa" }, { status: 403 });
  await setSessionCookie(await createSessionToken(user.id, user.role));
  return NextResponse.json({ id: user.id, role: user.role });
}
