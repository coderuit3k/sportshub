import { test, expect } from "@playwright/test";

async function imgInfo(img: any) {
  return img.evaluate((el: HTMLImageElement) => {
    const r = el.getBoundingClientRect();
    return { nw: el.naturalWidth, h: r.height, complete: el.complete };
  });
}

test("venue photos actually render (pixels, not just HTML)", async ({ page }) => {
  await page.goto("/venues");
  const cards = page.locator("article");
  await expect(cards.first()).toBeVisible();
  const n = await cards.count();
  console.log("cards:", n);
  for (let i = 0; i < n; i++) {
    const img = cards.nth(i).locator("img").first();
    await expect(img).toBeVisible();
    await expect.poll(async () => (await imgInfo(img)).nw, { timeout: 30000 }).toBeGreaterThan(0);
    const info = await imgInfo(img);
    console.log(`card ${i}:`, JSON.stringify(info));
    expect(info.h).toBeGreaterThanOrEqual(100);
  }
  await page.goto("/venues/pickle-hub-binh-thanh");
  const hero = page.locator("img").first();
  await expect(hero).toBeVisible();
  await expect.poll(async () => (await imgInfo(hero)).nw, { timeout: 30000 }).toBeGreaterThan(0);
  const hinfo = await imgInfo(hero);
  console.log("hero:", JSON.stringify(hinfo));
  expect(hinfo.h).toBeGreaterThanOrEqual(200);
});
