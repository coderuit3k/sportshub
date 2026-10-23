import { test, expect, type Locator } from "@playwright/test";
import { loginAsPlayer } from "./helpers";

async function participantCount(card: Locator): Promise<number> {
  const text = (await card.locator("p", { hasText: "người tham gia" }).textContent()) ?? "";
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) throw new Error(`Cannot parse participant count from: ${text}`);
  return Number(match[1]);
}

test.describe("community sessions", () => {
  test("player can join an open session and leave it again", async ({ page }) => {
    await loginAsPlayer(page);
    await page.goto("/community");

    // First session card with a join/leave toggle. NOTE: the seed makes the
    // demo player the organizer (and a participant) of the seeded sessions,
    // so the card may start in the joined state — normalize first, then
    // restore the original state at the end so reruns stay deterministic.
    const card = page
      .locator("article", { has: page.getByRole("button", { name: /Tham gia|Rời kèo/ }) })
      .first();
    await expect(card).toBeVisible();
    const title = (await card.locator("h2").textContent())?.trim() ?? "";
    expect(title).not.toBe("");
    const byTitle = () => page.locator("article", { hasText: title }).first();

    const initiallyJoined = (await card.getByRole("button", { name: "Rời kèo" }).count()) > 0;
    if (initiallyJoined) {
      await card.getByRole("button", { name: "Rời kèo" }).click();
      await expect(byTitle().getByRole("button", { name: "Tham gia" })).toBeVisible();
    }

    const before = await participantCount(byTitle());

    // Join — the button reloads the page, then shows "Rời kèo" and count + 1.
    await byTitle().getByRole("button", { name: "Tham gia" }).click();
    await expect(byTitle().getByRole("button", { name: "Rời kèo" })).toBeVisible();
    expect(await participantCount(byTitle())).toBe(before + 1);

    // Leave — back to "Tham gia" and the original count.
    await byTitle().getByRole("button", { name: "Rời kèo" }).click();
    await expect(byTitle().getByRole("button", { name: "Tham gia" })).toBeVisible();
    expect(await participantCount(byTitle())).toBe(before);

    // Restore the seeded state (player was a participant) for the next run.
    if (initiallyJoined) {
      await byTitle().getByRole("button", { name: "Tham gia" }).click();
      await expect(byTitle().getByRole("button", { name: "Rời kèo" })).toBeVisible();
      expect(await participantCount(byTitle())).toBe(before + 1);
    }
  });
});
