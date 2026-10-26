import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validateChangePasswordInput } from "@/lib/account/change-password";
import { passwordChangeLimiter, tooManyRequests } from "@/lib/rate-limit";

/**
 * Self-service password change. Session required; a user can only ever change
 * their OWN password (the target id always comes from the session, never from
 * the request body). The current password must be presented and verified.
 *
 * Session handling on success: the current session is KEPT. Sessions are
 * stateless JWTs (7-day) with no server-side revocation list, so other
 * sessions cannot be selectively revoked without new infrastructure; the
 * pragmatic, documented choice is to keep the acting session valid (the user
 * just proved knowledge of the old password) and let other sessions expire
 * naturally. See docs/security.md.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  // Password-guessing brake: EVERY attempt counts, 5 per hour per user —
  // the current password is verified below, so throttling must happen
  // before the compare, not after a failure (specific bucket — not also
  // counted into the generic write bucket).
  const gate = await passwordChangeLimiter.consume(`password-change:${user.id}`);
  if (!gate.allowed) return tooManyRequests(gate);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const validation = validateChangePasswordInput(body ?? {});
  if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 });

  const { currentPassword, newPassword } = body as { currentPassword: string; newPassword: string };
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return NextResponse.json({ error: "Mật khẩu hiện tại không đúng" }, { status: 400 });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 10) },
  });
  await prisma.auditLog.create({
    data: { actorId: user.id, action: "USER_PASSWORD_CHANGED", entity: "User", entityId: user.id, details: user.email },
  });
  return NextResponse.json({ ok: true });
}
