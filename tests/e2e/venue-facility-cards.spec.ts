import { test, expect } from "@playwright/test";

/**
 * Venue detail page — facility (sub-court) cards: the old bullet list
 * became a photo-card grid. Each card shows a rotated sport-pool photo,
 * the facility's own details and cheapest price, plus a "Đặt sân này"
 * quick-book button that must select that facility in the booking
 * widget (window CustomEvent) and scroll the widget into view.
 */
test("facility cards render with photos; 'Đặt sân này' on the 2nd card selects it in the booking widget", async ({ page }) => {
  await page.goto("/venues/smash-arena-thu-duc");

  const widget = page.locator("#booking-widget");
  await expect(widget).toBeVisible();
  const facilitySelect = widget.locator("select").first();

  // One card per facility the widget offers (seeded venue has ≥ 2).
  const options = facilitySelect.locator("option");
  const optionCount = await options.count();
  expect(optionCount).toBeGreaterThanOrEqual(2);
  const cards = page.getByTestId("facility-card");
  await expect(cards).toHaveCount(optionCount);

  // Every card renders a photo plus its capacity and own starting price.
  for (let i = 0; i < optionCount; i++) {
    const card = cards.nth(i);
    await expect(card.locator("img").first()).toBeVisible();
    await expect(card).toContainText(/Sức chứa \d+ người/);
    await expect(card).toContainText(/Từ .+\/giờ/);
  }

  // The widget starts on the first facility…
  const firstValue = await options.nth(0).getAttribute("value");
  const secondValue = await options.nth(1).getAttribute("value");
  expect(firstValue).toBeTruthy();
  expect(secondValue).toBeTruthy();
  await expect(facilitySelect).toHaveValue(firstValue!);

  // …and clicking the SECOND card's button switches it to that facility
  // (retry the click: a first click can land before hydration wires the
  // widget's event listener — the action itself is idempotent).
  await expect(async () => {
    await cards.nth(1).getByRole("button", { name: "Đặt sân này" }).click();
    await expect(facilitySelect).toHaveValue(secondValue!, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });

  // The click also scrolled the booking widget into view.
  await expect(widget).toBeInViewport();
});
