import { expect, test } from "@playwright/test";
import { PLAYER, login, loginAsPlayer } from "./helpers";

const NEW_PASSWORD = "NewPass789!";

/**
 * Self-service change password (completion round).
 * Runs against the seeded player account and RESTORES the original seed
 * password at the end so other specs (which log in with it) are unaffected.
 */
test("player can change password, old one stops working, then restores it", async ({ page }) => {
  await loginAsPlayer(page);

  // Change to the new password via /profile.
  await page.goto("/profile");
  await page.getByLabel("Mật khẩu hiện tại").fill(PLAYER.password);
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Nhập lại mật khẩu mới").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page.getByText("Đã đổi mật khẩu")).toBeVisible();

  // Log out; the OLD password must now fail…
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  // LogoutButton navigates via window.location — wait for the logged-out
  // header before navigating, otherwise goto races that navigation (ERR_ABORTED).
  await expect(page.getByRole("link", { name: "Đăng nhập" })).toBeVisible();
  await page.goto("/login");
  await page.getByLabel("Email").fill(PLAYER.email);
  await page.getByLabel("Mật khẩu").fill(PLAYER.password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  // Note: getByRole("alert") is ambiguous here — Next's route announcer also
  // carries role="alert". Assert on the message text instead.
  await expect(page.getByText("Email hoặc mật khẩu không đúng")).toBeVisible();

  // …and the NEW password must work.
  await login(page, PLAYER.email, NEW_PASSWORD);

  // Restore the seed password for the rest of the suite.
  await page.goto("/profile");
  await page.getByLabel("Mật khẩu hiện tại").fill(NEW_PASSWORD);
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(PLAYER.password);
  await page.getByLabel("Nhập lại mật khẩu mới").fill(PLAYER.password);
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page.getByText("Đã đổi mật khẩu")).toBeVisible();
});
