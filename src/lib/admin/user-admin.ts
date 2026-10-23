import { z } from "zod";

/**
 * Pure helpers for admin user management (Phase 3, Workstream A).
 * Kept DB-free so the password policy and the self-lock guard are unit-testable.
 */

export const MIN_ADMIN_PASSWORD_LENGTH = 10;

export const newPasswordSchema = z
  .string()
  .min(MIN_ADMIN_PASSWORD_LENGTH, `Mật khẩu mới phải có tối thiểu ${MIN_ADMIN_PASSWORD_LENGTH} ký tự`);

export type PasswordValidation = { valid: true } | { valid: false; error: string };

/** Validate a new password an admin wants to set for a user. */
export function validateNewPassword(password: unknown): PasswordValidation {
  const parsed = newPasswordSchema.safeParse(password);
  if (parsed.success) return { valid: true };
  return { valid: false, error: parsed.error.issues[0]?.message ?? "Mật khẩu mới không hợp lệ" };
}

/**
 * Self-lock guard: an admin must never lock their own account
 * (they would lock themselves out of the only admin session).
 * Resetting your OWN password is allowed; locking is not.
 */
export function canLockAccount(actorId: string, targetUserId: string): boolean {
  return actorId !== targetUserId;
}
