import { test, expect, type Locator, type Page } from "@playwright/test";

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
 * Ranking rules (src/lib/geo/rank.ts): rating desc → distance asc →
 * price asc. The featured grid holds the top 6 of a 170-venue catalog,
 * so the exact names are data-dependent; these specs assert the
 * RENDERED INVARIANTS of the ranking instead of a hardcoded order:
 *   - exactly 6 featured cards;
 *   - displayed ratings are non-increasing down the grid;
 *   - granted: every card shows a distance line, and between adjacent
 *     cards with equal displayed ratings the displayed distances are
 *     non-decreasing (display rounding is monotonic, so the rendered
 *     values preserve the underlying order);
 *   - denied: no distance lines at all.
 */

function featuredSection(page: Page) {
  return page.locator("section", { has: page.getByRole("heading", { name: "Sân nổi bật" }) });
}

/** Rating shown on a card: the <strong> next to the star icon ("4.9"). */
async function cardRating(card: Locator): Promise<number> {
  const text = (await card.locator("strong").first().textContent()) ?? "";
  const value = Number.parseFloat(text.trim());
  if (Number.isNaN(value)) throw new Error(`card rating is not numeric: "${text}"`);
  return value;
}

/** Distance shown on a card, in km ("47 m" → 0.047, "2,3 km" → 2.3). */
async function cardDistanceKm(card: Locator): Promise<number> {
  const text = (await card.getByText(/Cách bạn/).first().textContent()) ?? "";
  const m = text.match(/([\d]+(?:[.,]\d+)?)\s*(km|m)\b/);
  if (!m) throw new Error(`card distance not parseable: "${text}"`);
  const value = Number.parseFloat(m[1].replace(",", "."));
  return m[2] === "km" ? value : value / 1000;
}

async function expectRatingOrder(cards: Locator): Promise<number[]> {
  const ratings: number[] = [];
  const n = await cards.count();
  for (let i = 0; i < n; i++) ratings.push(await cardRating(cards.nth(i)));
  for (let i = 1; i < ratings.length; i++) {
    expect(ratings[i], `ratings must be non-increasing (got ${ratings.join(", ")})`)
      .toBeLessThanOrEqual(ratings[i - 1]);
  }
  return ratings;
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

    // Wait until the grant has been applied: a distance line on every
    // one of the 6 featured cards (before that, the grid is still in
    // the server-rendered default order and distances are absent).
    await expect(section.locator("article")).toHaveCount(6);
    await expect.poll(async () => section.getByText(/Cách bạn/).count(), { timeout: 15_000 }).toBe(6);

    // Rendered ranking invariants: ratings non-increasing, and where
    // adjacent ratings tie, distances non-decreasing.
    const cards = section.locator("article");
    const ratings = await expectRatingOrder(cards);
    for (let i = 1; i < ratings.length; i++) {
      if (ratings[i] === ratings[i - 1]) {
        const prev = await cardDistanceKm(cards.nth(i - 1));
        const curr = await cardDistanceKm(cards.nth(i));
        expect(curr, `equal ratings ${ratings[i]}: distances must be non-decreasing (${prev} → ${curr})`)
          .toBeGreaterThanOrEqual(prev);
      }
    }
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

    // The list is unharmed: all 6 featured cards visible, still in the
    // default ranking — displayed ratings non-increasing — and no
    // distance lines anywhere.
    await expect(section.locator("article")).toHaveCount(6);
    await expectRatingOrder(section.locator("article"));
    await expect(section.getByText(/Cách bạn/)).toHaveCount(0);
  });
});
