import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function openMap(page: Page) {
  const toggle = page.getByRole("link", { name: "Bản đồ" });
  await expect(toggle).toHaveAttribute("href", /view=map/);
  // Hydration can replace the link between mousedown and mouseup.
  await expect(async () => {
    await toggle.click();
    await expect(page).toHaveURL(/view=map/, { timeout: 2000 });
  }).toPass({ timeout: 15000 });
}

/**
 * /venues map view: the segmented toggle swaps the card grid for a
 * Leaflet map (OpenStreetMap tiles) with one default marker per venue
 * in the filtered set. Per the spec we assert on the Leaflet container
 * and marker elements only — never on tile images or tile network
 * traffic, which are outside this app's control.
 */
test("venues map view renders the Leaflet map with markers", async ({ page }) => {
  await page.goto("/venues");
  // List is the default view: venue cards render, no Leaflet anywhere.
  await expect(page.locator("article").first()).toBeVisible();
  await expect(page.locator(".leaflet-container")).toHaveCount(0);

  await openMap(page);
  await expect(page).toHaveURL(/view=map/);

  const map = page.locator(".leaflet-container");
  await expect(map).toBeVisible();
  // The seeded catalogue (119 real venues) has coordinates for every
  // venue, so the map must carry one marker per venue.
  const markers = page.locator(".leaflet-marker-icon");
  await expect(markers.first()).toBeVisible();
  await expect.poll(async () => markers.count(), { timeout: 30000 }).toBe(119);
  const count = await markers.count();
  console.log("map markers:", count);

  // Clicking a marker opens its popup with a link to the venue detail.
  // The real venues cluster tightly in the city centre, so the first
  // marker in DOM order can sit underneath a neighbouring pin (which
  // then intercepts the click) — walk the markers until one accepts
  // the click.
  let clicked = false;
  const total = await markers.count();
  for (let i = 0; i < total && !clicked; i++) {
    try {
      await markers.nth(i).click({ timeout: 2000 });
      clicked = true;
    } catch {
      // Covered by a neighbouring pin — try the next marker.
    }
  }
  expect(clicked).toBe(true);
  const popup = page.locator(".leaflet-popup-content");
  await expect(popup).toBeVisible();
  await expect(popup.locator('a[href^="/venues/"]')).toBeVisible();
});

test("map view keeps the active filters in the toggle and form", async ({ page }) => {
  await page.goto("/venues?sport=cau-long");
  await openMap(page);
  await expect(page).toHaveURL(/view=map/);
  await expect(page).toHaveURL(/sport=cau-long/);
  await expect(page.locator(".leaflet-container")).toBeVisible();
  // The filter form carries the view as a hidden field so refining the
  // filters stays on the map instead of bouncing back to the list.
  await expect(page.locator('form input[type="hidden"][name="view"]')).toHaveValue("map");
});
