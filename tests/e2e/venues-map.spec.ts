import { test, expect } from "@playwright/test";

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

  await page.getByRole("link", { name: "Bản đồ" }).click();
  await expect(page).toHaveURL(/view=map/);

  const map = page.locator(".leaflet-container");
  await expect(map).toBeVisible();
  // The seeded catalogue has coordinates for every venue, so the map
  // must carry markers (170 in the full unfiltered set).
  const markers = page.locator(".leaflet-marker-icon");
  await expect(markers.first()).toBeVisible();
  const count = await markers.count();
  console.log("map markers:", count);
  expect(count).toBeGreaterThan(0);

  // Clicking a marker opens its popup with a link to the venue detail.
  await markers.first().click();
  const popup = page.locator(".leaflet-popup-content");
  await expect(popup).toBeVisible();
  await expect(popup.locator('a[href^="/venues/"]')).toBeVisible();
});

test("map view keeps the active filters in the toggle and form", async ({ page }) => {
  await page.goto("/venues?sport=cau-long");
  await page.getByRole("link", { name: "Bản đồ" }).click();
  await expect(page).toHaveURL(/view=map/);
  await expect(page).toHaveURL(/sport=cau-long/);
  await expect(page.locator(".leaflet-container")).toBeVisible();
  // The filter form carries the view as a hidden field so refining the
  // filters stays on the map instead of bouncing back to the list.
  await expect(page.locator('form input[type="hidden"][name="view"]')).toHaveValue("map");
});
