import { expect, type Page } from "@playwright/test";

/** Seeded local-dev accounts (see prisma/seed.ts / README — local only). */
export const PLAYER = { email: "player@sportshub.local", password: "Password123!" };
export const ADMIN = { email: "admin@sportshub.local", password: "Password123!" };

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  // Header switches to the logged-in state (logout button + user links).
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
}

export function loginAsPlayer(page: Page): Promise<void> {
  return login(page, PLAYER.email, PLAYER.password);
}

/** Format a Date as yyyy-mm-dd in local time for <input type="date">. */
export function toDateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A future date 7–16 days out. The day offset rotates with the calendar day so
 * repeated local runs don't keep colliding with the booking widget's
 * deterministic idempotency key (date + slot) from earlier runs.
 */
export function futureDate(): Date {
  const d = new Date();
  const rotate = Math.floor(Date.now() / 86_400_000) % 10;
  d.setDate(d.getDate() + 7 + rotate);
  return d;
}
