import { test, expect } from "@playwright/test";
import { loginAsPlayer, futureDate, toDateInputValue } from "./helpers";

test.describe("booking flow", () => {
  test("player books an available slot, sees it in My Bookings, then cancels with refund preview", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept()); // window.confirm() on cancel
    await loginAsPlayer(page);

    // Open the first venue from Explore.
    await page.goto("/venues");
    const venueLink = page.locator('article h3 a[href^="/venues/"]').first();
    await expect(venueLink).toBeVisible();
    await venueLink.click();
    const widget = page.locator("div.card", { has: page.getByRole("heading", { name: /Đặt sân —/ }) });
    await expect(widget).toBeVisible();

    // Pick a future date and the first enabled slot; confirm the booking.
    // If a previous test run already used (and cancelled) the same slot, the
    // deterministic idempotency key returns that CANCELLED booking — then we
    // move to another slot/day until a fresh booking succeeds.
    const statusBox = widget.locator('[role="status"]');
    let reference = "";
    let booked = false;
    outer: for (let dayShift = 0; dayShift < 3 && !booked; dayShift++) {
      const date = futureDate();
      date.setDate(date.getDate() + dayShift);
      await widget.locator('input[type="date"]').fill(toDateInputValue(date));
      const slots = widget.locator("div.grid button:not([disabled])");
      const count = Math.min(await slots.count(), 6);
      for (let i = 0; i < count; i++) {
        await slots.nth(i).click();
        await widget.getByRole("button", { name: "Xác nhận đặt sân" }).click();
        await expect(statusBox).toContainText(/Đặt thành công|thất bại|không/i);
        const text = (await statusBox.textContent()) ?? "";
        if (text.includes("Đặt thành công") && !text.includes("CANCELLED")) {
          const match = text.match(/Mã\s+(\S+)/);
          reference = match?.[1] ?? "";
          booked = true;
          break outer;
        }
      }
    }
    expect(booked, "expected a fresh booking to succeed").toBe(true);
    expect(reference).not.toBe("");

    // The booking must appear in My Bookings (upcoming or pending tab).
    await page.goto("/my-bookings");
    let card = page.locator("article", { hasText: reference });
    if ((await card.count()) === 0) {
      await page.getByRole("link", { name: /Chờ duyệt/ }).click();
      card = page.locator("article", { hasText: reference });
    }
    await expect(card).toBeVisible();
    // Refund preview is shown before cancelling.
    await expect(card).toContainText("Nếu hủy bây giờ");

    // Cancel it (confirm dialog auto-accepted above); the page reloads.
    await card.getByRole("button", { name: "Hủy đặt" }).click();
    await page.waitForLoadState("networkidle");

    // It must now be listed under the cancelled tab as CANCELLED.
    await page.goto("/my-bookings?tab=cancelled");
    const cancelledCard = page.locator("article", { hasText: reference });
    await expect(cancelledCard).toBeVisible();
    await expect(cancelledCard).toContainText("CANCELLED");
  });
});
