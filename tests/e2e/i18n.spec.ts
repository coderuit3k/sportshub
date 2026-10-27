import { test, expect } from "@playwright/test";

/**
 * i18n: cookie-based locale (NEXT_LOCALE) with a navbar switcher.
 * Default (no cookie) must be Vietnamese — the rest of the suite is the
 * regression net for that. Here we verify switching to English, its
 * persistence across reloads (cookie), switching back, and that the
 * translated list/detail surfaces still render real venue photos.
 */

async function pickLanguage(page: import("@playwright/test").Page, switcherLabel: string, optionName: RegExp) {
  await page.getByRole("button", { name: switcherLabel }).click();
  await page.getByRole("option", { name: optionName }).click();
}

test("language switcher: vi default → en persists → back to vi", async ({ page }) => {
  // FeaturedVenues asks the Geolocation API on mount (no in-page
  // button) and reacts fully silently — no location-state text in
  // any locale. Stub a deterministic denial so the flow below never
  // depends on the runner's real permission state.
  await page.addInitScript(() => {
    const denied = {
      getCurrentPosition: (_success: unknown, error: (e: unknown) => void) =>
        error({ code: 1, message: "User denied Geolocation" }),
      watchPosition: () => 0,
      clearWatch: () => undefined,
    };
    Object.defineProperty(navigator, "geolocation", { get: () => denied });
  });

  await page.goto("/");
  // Default: Vietnamese chrome, <html lang="vi">.
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await expect(page.getByRole("link", { name: "Trang chủ" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sân nổi bật" })).toBeVisible();
  await expect(page.getByText("khám phá, đặt sân và ghép kèo")).toBeVisible();

  // Switch to English via the navbar switcher.
  await pickLanguage(page, "Ngôn ngữ", /English/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Featured venues" })).toBeVisible();
  await expect(page.getByText("discover venues, book courts")).toBeVisible();
  // No locate button exists anymore, and location handling is fully
  // silent: with geolocation denied, neither the English error note
  // nor the English status line renders anywhere on the page.
  await expect(page.getByRole("button", { name: "Use my location" })).toHaveCount(0);
  await expect(page.getByText("Couldn't get your location")).toHaveCount(0);
  await expect(page.getByText("Ranked by your location")).toHaveCount(0);

  // Persists across a full reload (cookie, not just client state).
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Featured venues" })).toBeVisible();

  // Switch back to Vietnamese.
  await pickLanguage(page, "Language", /Tiếng Việt/);
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await expect(page.getByRole("heading", { name: "Sân nổi bật" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Trang chủ" })).toBeVisible();
});

test("english /venues + venue detail render translated labels and real photos", async ({ context, page }) => {
  await context.addCookies([
    { name: "NEXT_LOCALE", value: "en", url: "http://localhost:3100" },
  ]);
  await page.goto("/venues");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: /Explore & book venues/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Filters" })).toBeVisible();
  await expect(page.getByText("(119 results)")).toBeVisible();

  // Pixel-level guard (same bar as venue-images.spec.ts): the first
  // card's photo must actually paint, not just exist in the HTML.
  const firstCard = page.locator("article").first();
  const cardImg = firstCard.locator("img").first();
  await expect(cardImg).toBeVisible();
  await expect
    .poll(async () => cardImg.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 30000 })
    .toBeGreaterThan(0);
  const cardBox = await cardImg.evaluate((el: HTMLImageElement) => el.getBoundingClientRect().height);
  expect(cardBox).toBeGreaterThanOrEqual(100);

  await page.goto("/venues/san-cau-long-dong-ho");
  await expect(page.getByRole("heading", { name: "Transparent pricing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Book — / })).toBeVisible();
  await expect(page.getByText("Verified venue")).toBeVisible();
  await expect(page.getByText("Badminton").first()).toBeVisible();
  await expect(page.getByText("Parking").first()).toBeVisible();
  const hero = page.locator("img").first();
  await expect(hero).toBeVisible();
  await expect
    .poll(async () => hero.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 30000 })
    .toBeGreaterThan(0);
  const heroBox = await hero.evaluate((el: HTMLImageElement) => el.getBoundingClientRect().height);
  expect(heroBox).toBeGreaterThanOrEqual(200);
});
