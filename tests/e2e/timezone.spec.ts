import { test, expect } from "@playwright/test";
import { loginAsPlayer, saturdayDateISO, confirmBookingAndReadStatus } from "./helpers";

// Regression spec for the production timezone bug: with the server running
// under a UTC process TZ (as on Vercel), booking "Saturday 14:00" used to be
// stored as 14:00Z (= 21:00 Asia/Ho_Chi_Minh) and priced by the wrong wall
// clock. This spec pins the correct behavior end to end: the 14:00 slot on a
// Saigon Saturday must show the WEEKEND price (160.000 đ/h in seed data),
// and My Bookings must render it back at 14:00–15:00 on that Saturday.
test.describe("timezone regression (Asia/Ho_Chi_Minh anchoring)", () => {
  test("Saturday 14:00 books at Saigon wall time with weekend pricing", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept()); // window.confirm() on cancel
    await loginAsPlayer(page);

    // Go straight to the flagship badminton venue: its seed price rules
    // are the ones this spec's 160.000 đ weekend expectation is written
    // against (catalog venues carry per-sport prices instead, and the
    // first card on /venues is no longer guaranteed to be a flagship).
    await page.goto("/venues/smash-arena-thu-duc");
    const widget = page.locator("div.card", { has: page.getByRole("heading", { name: /Đặt sân —/ }) });
    await expect(widget).toBeVisible();

    // Try successive Saturdays until a fresh booking succeeds. Note the
    // self-poisoning interaction: the widget's idempotency key is
    // deterministic (facility + start instant), and this spec CANCELS its
    // booking during cleanup — so on the next run against the same dev DB,
    // that Saturday's key returns the old CANCELLED booking instead of
    // creating a new one, and we must move one week further out. The long
    // runway (10 weeks) absorbs many local re-runs; CI always seeds a fresh
    // DB, where the first Saturday works immediately.
    const statusBox = widget.locator('[role="status"]');
    let reference = "";
    let booked = false;
    for (let week = 0; week < 10 && !booked; week++) {
      await widget.locator('input[type="date"]').fill(saturdayDateISO(week));
      const slotBtn = widget.locator("div.grid button", { hasText: "14:00" }).first();
      await expect(slotBtn).toBeVisible();
      if (await slotBtn.isDisabled()) continue; // already taken that Saturday
      // Weekend price must be displayed per-hour BEFORE booking.
      await expect(slotBtn).toContainText("160.000");
      await slotBtn.click();
      const text = await confirmBookingAndReadStatus(widget, statusBox);
      if (text.includes("Đặt thành công") && !text.includes("CANCELLED")) {
        reference = text.match(/Mã\s+(\S+)/)?.[1] ?? "";
        booked = true;
      }
    }
    expect(booked, "expected a fresh Saturday 14:00 booking to succeed").toBe(true);
    expect(reference).not.toBe("");

    // My Bookings renders times in Asia/Ho_Chi_Minh: must read 14:00 → 15:00
    // at the weekend total — NOT 21:00 (the old UTC-anchored bug).
    await page.goto("/my-bookings");
    let card = page.locator("article", { hasText: reference });
    if ((await card.count()) === 0) {
      await page.getByRole("link", { name: /Chờ duyệt/ }).click();
      card = page.locator("article", { hasText: reference });
    }
    await expect(card).toBeVisible();
    await expect(card).toContainText("14:00");
    await expect(card).toContainText("15:00");
    await expect(card).toContainText("160.000");

    // Cleanup: cancel so re-runs and other specs see a free slot.
    await card.getByRole("button", { name: "Hủy đặt" }).click();
    await page.waitForLoadState("networkidle");
  });
});
