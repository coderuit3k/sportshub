import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { getClientIp, rateLimitHeaders, registerLimiter, tooManyRequests } from "@/lib/rate-limit";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["PLAYER", "OWNER"]).default("PLAYER"),
});
export async function POST(req: Request) {
  const gate = await registerLimiter.consume(`register:${getClientIp(req)}`);
  if (!gate.allowed) {
    // TEMP-DIAGNOSTIC: rate-limit headers, remove after production verification.
    const res = tooManyRequests(gate);
    for (const [k, v] of Object.entries(rateLimitHeaders(registerLimiter, gate))) res.headers.set(k, v);
    return res;
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Dữ liệu không hợp lệ (mật khẩu tối thiểu 8 ký tự)" },
      // TEMP-DIAGNOSTIC: rate-limit headers, remove after production verification.
      { status: 400, headers: rateLimitHeaders(registerLimiter, gate) },
    );
  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (exists)
    return NextResponse.json(
      { error: "Email đã được đăng ký" },
      // TEMP-DIAGNOSTIC: rate-limit headers, remove after production verification.
      { status: 409, headers: rateLimitHeaders(registerLimiter, gate) },
    );
  const user = await prisma.user.create({
    data: { name: parsed.data.name, email: parsed.data.email, passwordHash: await bcrypt.hash(parsed.data.password, 10), role: parsed.data.role },
  });
  await prisma.userPreference.create({ data: { userId: user.id } });
  await setSessionCookie(await createSessionToken(user.id, user.role));
  return NextResponse.json({ id: user.id, role: user.role });
}
