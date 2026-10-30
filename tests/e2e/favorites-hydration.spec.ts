import { test, expect, type Page } from "@playwright/test";
import { loginAsPlayer } from "./helpers";

/**
 * Favorites hydration on the cacheable public pages.
 *
 * Home and venue detail render WITHOUT user context (their data comes
 * from the data cache in src/lib/public-data.ts, favorite state always
 * starts "off"), so hearts/buttons must correct themselves client-side
 * from GET /api/me/favorites after mount. These specs pin that contract:
 * anonymous visitors never see hearts (and get the login link on the
 * detail page); a signed-in user's saved venue shows its heart on the
 * homepage without any server-side knowledge.
 */

const VENUE_SLUG = "san-cau-long-dong-ho";

function featuredSection(page: Page) {
  return page.locator("section", { has: page.getByRole("heading", { name: "Sân nổi bật" }) });
}

test("anonymous: no hearts on the homepage; login link on the venue detail", async ({ page }) => {
  await page.goto("/");
  const section = featuredSection(page);
  await expect(section.locator("article").first()).toBeVisible();
  // Give hydration a chance to (wrongly) light a heart — it must not.
  await expect(section.locator("svg.fill-red-500")).toHaveCount(0);

  await page.goto(`/venues/${VENUE_SLUG}`);
  // The favorite control resolves to the login link for anonymous visitors.
  await expect(page.getByRole("link", { name: "Đăng nhập để lưu yêu thích & đặt sân" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Lưu yêu thích/ })).toHaveCount(0);
});

test("signed-in: favorite toggled on detail hydrates the homepage heart and the button state", async ({ page }) => {
  await loginAsPlayer(page);
  await page.goto("/");
  const featuredLink = featuredSection(page).locator('article h3 a').first();
  await expect(featuredLink).toBeVisible();
  const detailUrl = await featuredLink.getAttribute("href");
  expect(detailUrl).toMatch(/^\/venues\//);

  // Save the venue from its detail page (same POST endpoint as before).
  await page.goto(detailUrl!);
  const saveButton = page.getByRole("button", { name: "Lưu yêu thích" });
  await expect(saveButton).toBeVisible();
  await saveButton.click();
  await expect(page.getByRole("button", { name: "Đã lưu yêu thích" })).toBeVisible();

  // Homepage: the server DTO said "not favorite" — the heart must appear
  // purely from client hydration against /api/me/favorites.
  await page.goto("/");
  const section = featuredSection(page);
  const card = section.locator("article", { has: page.locator(`a[href="${detailUrl}"]`) });
  await expect(card.locator("svg.fill-red-500")).toBeVisible();

  // Back on the detail page, the button must come up already-saved
  // (hydrated), without any click.
  await page.goto(detailUrl!);
  await expect(page.getByRole("button", { name: "Đã lưu yêu thích" })).toBeVisible();

  // Cleanup: unsave so the seeded DB returns to its pristine state.
  await page.getByRole("button", { name: "Đã lưu yêu thích" }).click();
  await expect(page.getByRole("button", { name: "Lưu yêu thích" })).toBeVisible();
  await page.goto("/");
  await expect(featuredSection(page).locator("svg.fill-red-500")).toHaveCount(0);
});
