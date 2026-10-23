import { validateNewPassword } from "@/lib/admin/user-admin";

/**
 * Pure validation for the self-service "Đổi mật khẩu" flow.
 * DB/bcrypt checks (current-password verification) live in the route handler;
 * everything shape/policy related lives here so it is unit-testable.
 * The new-password policy is the SAME policy admins use when resetting a
 * password (`validateNewPassword`, min 10 chars) — one policy, one source.
 */

export interface ChangePasswordInput {
  currentPassword?: unknown;
  newPassword?: unknown;
  confirmPassword?: unknown;
}

export type ChangePasswordValidation = { valid: true } | { valid: false; error: string };

export function validateChangePasswordInput(input: ChangePasswordInput): ChangePasswordValidation {
  const { currentPassword, newPassword, confirmPassword } = input;
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return { valid: false, error: "Vui lòng nhập mật khẩu hiện tại" };
  }
  const policy = validateNewPassword(newPassword);
  if (!policy.valid) return policy;
  if (newPassword === currentPassword) {
    return { valid: false, error: "Mật khẩu mới phải khác mật khẩu hiện tại" };
  }
  if (confirmPassword !== newPassword) {
    return { valid: false, error: "Mật khẩu nhập lại không khớp" };
  }
  return { valid: true };
}
