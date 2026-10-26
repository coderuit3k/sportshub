import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canChangeRole, canLockAccount, validateNewPassword, validateUserRole } from "@/lib/admin/user-admin";
import { genericWriteLimiter, tooManyRequests } from "@/lib/rate-limit";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-password"), password: z.string() }),
  z.object({ action: z.literal("set-role"), role: z.string() }),
  z.object({ action: z.literal("lock") }),
]);

/**
 * Admin user management (Phase 3, Workstream A).
 * Lets an ADMIN rotate a user's password, change their role or lock the
 * account from the admin UI, so the seeded demo accounts can be secured
 * without any credential passing through chat/support channels. This
 * endpoint is the ONLY way to grant ADMIN — self-registration accepts
 * PLAYER/OWNER only. Every action is audit-logged.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor || actor.role !== "ADMIN") return NextResponse.json({ error: "Chỉ Admin" }, { status: 403 });
  // Admin mutations are NOT exempt from rate limiting: they land in the
  // generic authenticated-write bucket, keyed by the acting admin.
  const gate = await genericWriteLimiter.consume(`write:${actor.id}`);
  if (!gate.allowed) return tooManyRequests(gate);
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "Không tìm thấy người dùng" }, { status: 404 });

  if (parsed.data.action === "set-password") {
    const check = validateNewPassword(parsed.data.password);
    if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });
    await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(parsed.data.password, 10) } });
    await prisma.auditLog.create({
      data: { actorId: actor.id, action: "USER_PASSWORD_RESET", entity: "User", entityId: id, details: target.email },
    });
    return NextResponse.json({ ok: true, action: "set-password", userId: id });
  }

  if (parsed.data.action === "set-role") {
    const check = validateUserRole(parsed.data.role);
    if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });
    if (!canChangeRole(actor.id, id)) {
      return NextResponse.json({ error: "Không thể tự thay đổi vai trò của chính bạn" }, { status: 400 });
    }
    const previousRole = target.role;
    await prisma.user.update({ where: { id }, data: { role: check.role } });
    await prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "USER_ROLE_CHANGED",
        entity: "User",
        entityId: id,
        details: `${target.email}: ${previousRole} → ${check.role}`,
      },
    });
    return NextResponse.json({ ok: true, action: "set-role", userId: id, role: check.role });
  }

  // action === "lock": replace the hash with a hash of an unknown random value,
  // so no known password can sign in. An admin can unlock by setting a new password.
  if (!canLockAccount(actor.id, id)) {
    return NextResponse.json({ error: "Không thể tự khoá tài khoản của chính bạn" }, { status: 400 });
  }
  const unknownSecret = randomBytes(32).toString("hex");
  await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(unknownSecret, 10) } });
  await prisma.auditLog.create({
    data: { actorId: actor.id, action: "USER_LOCKED", entity: "User", entityId: id, details: target.email },
  });
  return NextResponse.json({ ok: true, action: "lock", userId: id });
}
