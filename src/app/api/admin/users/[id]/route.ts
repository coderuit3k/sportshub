import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canLockAccount, validateNewPassword } from "@/lib/admin/user-admin";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-password"), password: z.string() }),
  z.object({ action: z.literal("lock") }),
]);

/**
 * Admin user management (Phase 3, Workstream A).
 * Lets an ADMIN rotate a user's password or lock the account from the admin UI,
 * so the seeded demo accounts can be secured without any credential passing
 * through chat/support channels. Every action is audit-logged.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor || actor.role !== "ADMIN") return NextResponse.json({ error: "Chỉ Admin" }, { status: 403 });
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
