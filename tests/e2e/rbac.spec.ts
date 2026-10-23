import { test, expect } from "@playwright/test";
import { loginAsPlayer } from "./helpers";

test.describe("RBAC guards", () => {
  test("logged-in player is redirected away from /admin", async ({ page }) => {
    await loginAsPlayer(page);
    await page.goto("/admin");
    // Middleware bounces non-admin roles to the homepage.
    await expect(page).toHaveURL(/localhost:3100\/$/);
    await expect(page.getByRole("heading", { name: /Super Admin/ })).toHaveCount(0);
    await expect(page.getByText("Hàng đợi duyệt sân")).toHaveCount(0);
  });

  test("logged-out visitor to /my-bookings is redirected to /login", async ({ page }) => {
    await page.goto("/my-bookings");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
  });
});
