import { test, expect } from "@playwright/test";

async function imgInfo(img: any) {
  return img.evaluate((el: HTMLImageElement) => {
    const r = el.getBoundingClientRect();
    return { nw: el.naturalWidth, h: r.height, complete: el.complete };
  });
}

test("venue photos actually render on /venues page 1 (pixels, not just HTML)", async ({ page }) => {
  // 12 card photos load through the Next image optimizer from remote
  // CDNs — give the whole loop more room than the 60 s suite default.
  test.setTimeout(180_000);
  await page.goto("/venues");
  const cards = page.locator("article");
  await expect(cards.first()).toBeVisible();
  // Server-side pagination: exactly one page of 12 cards.
  await expect(cards).toHaveCount(12);
  const n = await cards.count();
  console.log("cards:", n);
  for (let i = 0; i < n; i++) {
    const img = cards.nth(i).locator("img").first();
    await expect(img).toBeVisible();
    await expect.poll(async () => (await imgInfo(img)).nw, { timeout: 30000 }).toBeGreaterThan(0);
    const info = await imgInfo(img);
    console.log(`card ${i}:`, JSON.stringify(info));
    // Card banner is h-40 = 160 px tall; a collapsed/zero-height box is
    // the regression this spec exists to catch.
    expect(info.h).toBeGreaterThanOrEqual(158);
  }
});

test("venue detail hero photo actually renders", async ({ page }) => {
  await page.goto("/venues/pickle-hub-binh-thanh");
  const hero = page.locator("img").first();
  await expect(hero).toBeVisible();
  await expect.poll(async () => (await imgInfo(hero)).nw, { timeout: 30000 }).toBeGreaterThan(0);
  const hinfo = await imgInfo(hero);
  console.log("hero:", JSON.stringify(hinfo));
  expect(hinfo.h).toBeGreaterThanOrEqual(200);
});
