import { test, expect, type Page } from "@playwright/test";

/**
 * Geolocation ranking for the homepage "Sân nổi bật" section.
 *
 * There is NO in-page locate button and NO location-state text of
 * any kind: on mount the component calls the Geolocation API, the
 * browser/device shows its native permission prompt, and the section
 * reacts silently. Granted → distances appear and the grid re-ranks;
 * denied → nothing changes visually beyond the default ranking
 * staying (full silence — no status line, no error note).
 *
 * Ranking rules (src/lib/geo/rank.ts): rating desc → distance asc → price asc.
 * All seed venues share the same price rules (min 120.000 đ), so with the
 * browser positioned in Thủ Đức (10.8500, 106.7550 — ~47 m from Smash
 * Arena) the expected order is decided by rating, with the 4.6★ tie
 * between the two Quận 7 venues broken by distance:
 *   Smash 4.9★ (~0,05 km) → Riverside 4.8★ (~9,3 km) → PickleHub 4.7★
 *   (~7,3 km) → Football Q7 4.6★ (~13,3 km) → Aqua Q7 4.6★ (~14,2 km)
 *   → Hoops 4.5★ (~1,2 km — nearest after Smash, but lowest rated).
 * The same order is also the default (rating → price) order because the
 * seed prices are identical, which the denied test relies on.
 */
const EXPECTED_ORDER = [
  "CLB Cầu Lông Smash Arena Thủ Đức",
  "Riverside Tennis Quận 1",
  "PickleHub Bình Thạnh",
  "Sân Bóng Mini Sài Gòn Quận 7",
  "Aqua Pool Quận 7",
  "Hoops Center Thủ Đức",
];

function featuredSection(page: Page) {
  return page.locator("section", { has: page.getByRole("heading", { name: "Sân nổi bật" }) });
}

test.describe("geolocation granted (Thủ Đức)", () => {
  test.use({
    permissions: ["geolocation"],
    geolocation: { latitude: 10.85, longitude: 106.755 },
  });

  test("auto-ranks by rating → distance → price on load, with no locate button", async ({ page }) => {
    await page.goto("/");
    const section = featuredSection(page);
    await expect(section.locator("article").first()).toBeVisible();

    // The old opt-in UI is gone: no locate button anywhere on the page.
    await expect(page.getByRole("button", { name: "Dùng vị trí của tôi" })).toHaveCount(0);

    // Without clicking anything, the granted position re-ranks the
    // grid — fully silently: no status line about the location state.
    await expect(section.getByText("Đang xếp theo vị trí của bạn")).toHaveCount(0);
    await expect(section.getByText("Không lấy được vị trí")).toHaveCount(0);

    // Distances appear on the cards (first card carries one).
    const firstCard = section.locator("article").first();
    await expect(firstCard.getByText(/Cách bạn \d+([.,]\d+)?\s*(km|m)/)).toBeVisible();

    // Smash Arena is ~47 m from the fake position → metre formatting.
    await expect(firstCard.getByText(/Cách bạn \d+ m/)).toBeVisible();

    // Visible order equals the ranking rules applied to the seed data.
    const names = (await section.locator("article h3").allTextContents()).map((t) => t.trim());
    expect(names).toEqual(EXPECTED_ORDER);

    // Every card shows a distance; Hoops (last, lowest rated) shows ~1,2 km.
    await expect(section.getByText(/Cách bạn/)).toHaveCount(6);
    await expect(section.locator("article").last().getByText("Cách bạn 1,2 km")).toBeVisible();
  });
});

test.describe("geolocation denied", () => {
  test("stays fully silent on load and keeps the default ranking visible", async ({ page }) => {
    // Deterministically simulate a denied permission: the browser calls
    // the error callback (code 1) instead of ever returning a position.
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
    const section = featuredSection(page);
    await expect(section.locator("article").first()).toBeVisible();

    // No locate button here either — and no location-state text at
    // all: neither the error note nor the granted status line renders.
    await expect(page.getByRole("button", { name: "Dùng vị trí của tôi" })).toHaveCount(0);
    await expect(section.getByText("Không lấy được vị trí")).toHaveCount(0);
    await expect(section.getByText("Đang xếp theo vị trí của bạn")).toHaveCount(0);

    // The list is unharmed: all 6 cards visible, still in the default
    // rating → price order (seed prices are identical, so rating decides,
    // and the 4.6★ tie keeps seed order: Football Q7 before Aqua Q7).
    await expect(section.locator("article")).toHaveCount(6);
    const names = (await section.locator("article h3").allTextContents()).map((t) => t.trim());
    expect(names).toEqual(EXPECTED_ORDER);
    await expect(section.getByText(/Cách bạn/)).toHaveCount(0);
  });
});
