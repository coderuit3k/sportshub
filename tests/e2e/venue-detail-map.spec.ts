import { test, expect } from "@playwright/test";

/**
 * Venue detail page map: a plain Leaflet map over OpenStreetMap RASTER
 * tiles with a single marker at the venue's coordinates. It replaces
 * the openstreetmap.org embed iframe, whose current viewer is
 * WebGL-based (MapLibre GL) and shows an error box on machines without
 * WebGL (e.g. RDP sessions) — raster Leaflet needs no WebGL. Per the
 * suite convention we assert on the Leaflet container/marker elements
 * only, never on tile images or tile network traffic.
 */
test("venue detail page renders a Leaflet map with one marker and no OSM embed iframe", async ({ page }) => {
  await page.goto("/venues/smash-arena-thu-duc");

  const map = page.locator(".leaflet-container");
  await expect(map).toBeVisible();

  // Exactly one marker: the venue itself.
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1);

  // Leaflet's own attribution control credits OpenStreetMap.
  await expect(page.locator(".leaflet-control-attribution")).toContainText("OpenStreetMap");

  // The WebGL embed iframe must be gone entirely.
  await expect(page.locator('iframe[src*="openstreetmap.org/export/embed"]')).toHaveCount(0);
});
