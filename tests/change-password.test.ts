import { describe, expect, it } from "vitest";
import { validateChangePasswordInput } from "@/lib/account/change-password";

const OK = { currentPassword: "OldPass123!", newPassword: "NewPass456!", confirmPassword: "NewPass456!" };

describe("validateChangePasswordInput", () => {
  it("accepts a valid change", () => {
    expect(validateChangePasswordInput(OK)).toEqual({ valid: true });
  });

  it("requires the current password", () => {
    expect(validateChangePasswordInput({ ...OK, currentPassword: "" }).valid).toBe(false);
    expect(validateChangePasswordInput({ ...OK, currentPassword: undefined }).valid).toBe(false);
  });

  it("enforces the shared min-10 policy on the new password", () => {
    const r = validateChangePasswordInput({ ...OK, newPassword: "short", confirmPassword: "short" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain("10");
  });

  it("rejects new == current", () => {
    const r = validateChangePasswordInput({ currentPassword: "SamePass123!", newPassword: "SamePass123!", confirmPassword: "SamePass123!" });
    expect(r.valid).toBe(false);
  });

  it("rejects a mismatched confirmation", () => {
    const r = validateChangePasswordInput({ ...OK, confirmPassword: "Different789!" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain("không khớp");
  });
});
