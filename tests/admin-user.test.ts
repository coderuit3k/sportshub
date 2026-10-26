import { describe, it, expect } from "vitest";
import {
  MIN_ADMIN_PASSWORD_LENGTH,
  validateNewPassword,
  canLockAccount,
  validateUserRole,
  canChangeRole,
} from "@/lib/admin/user-admin";

describe("admin new-password policy", () => {
  it("accepts a password of exactly the minimum length", () => {
    const pw = "a".repeat(MIN_ADMIN_PASSWORD_LENGTH);
    expect(validateNewPassword(pw)).toEqual({ valid: true });
  });
  it("accepts a longer password", () => {
    expect(validateNewPassword("S3cure-Passphrase-2026")).toEqual({ valid: true });
  });
  it("rejects a password shorter than the minimum", () => {
    const r = validateNewPassword("a".repeat(MIN_ADMIN_PASSWORD_LENGTH - 1));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain(String(MIN_ADMIN_PASSWORD_LENGTH));
  });
  it("rejects empty / non-string input", () => {
    expect(validateNewPassword("").valid).toBe(false);
    expect(validateNewPassword(undefined).valid).toBe(false);
    expect(validateNewPassword(12345678901).valid).toBe(false);
    expect(validateNewPassword(null).valid).toBe(false);
  });
});

describe("admin self-lock guard", () => {
  it("an admin cannot lock their own account", () => {
    expect(canLockAccount("admin-1", "admin-1")).toBe(false);
  });
  it("an admin can lock another user's account", () => {
    expect(canLockAccount("admin-1", "player-9")).toBe(true);
    expect(canLockAccount("admin-1", "owner-2")).toBe(true);
  });
});

describe("admin role validation", () => {
  it("accepts every grantable role, including ADMIN (admin panel only)", () => {
    expect(validateUserRole("PLAYER")).toEqual({ valid: true, role: "PLAYER" });
    expect(validateUserRole("OWNER")).toEqual({ valid: true, role: "OWNER" });
    expect(validateUserRole("ADMIN")).toEqual({ valid: true, role: "ADMIN" });
  });
  it("rejects unknown / mistyped roles", () => {
    expect(validateUserRole("SUPERADMIN").valid).toBe(false);
    expect(validateUserRole("player").valid).toBe(false);
    expect(validateUserRole("").valid).toBe(false);
    expect(validateUserRole(undefined).valid).toBe(false);
    expect(validateUserRole(null).valid).toBe(false);
    expect(validateUserRole(42).valid).toBe(false);
  });
});

describe("admin self role-change guard", () => {
  it("an admin cannot change their own role", () => {
    expect(canChangeRole("admin-1", "admin-1")).toBe(false);
  });
  it("an admin can change another user's role", () => {
    expect(canChangeRole("admin-1", "player-9")).toBe(true);
    expect(canChangeRole("admin-1", "admin-2")).toBe(true);
  });
});
