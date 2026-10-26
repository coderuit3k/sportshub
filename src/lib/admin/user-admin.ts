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

export const USER_ROLES = ["PLAYER", "OWNER", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const userRoleSchema = z.enum(USER_ROLES);

export type RoleValidation = { valid: true; role: UserRole } | { valid: false; error: string };

/**
 * Validate a role an admin wants to grant. Self-registration accepts only
 * PLAYER/OWNER (its route schema), but an admin may grant any role —
 * including ADMIN — from the admin panel.
 */
export function validateUserRole(role: unknown): RoleValidation {
  const parsed = userRoleSchema.safeParse(role);
  if (parsed.success) return { valid: true, role: parsed.data };
  return { valid: false, error: "Vai trò không hợp lệ (chỉ PLAYER, OWNER hoặc ADMIN)" };
}

/**
 * Self role-change guard: an admin must never change their own role —
 * demoting themselves would strand the platform without an admin session,
 * and self-service role edits bypass the second pair of eyes entirely.
 */
export function canChangeRole(actorId: string, targetUserId: string): boolean {
  return actorId !== targetUserId;
}
