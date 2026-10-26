import { test, expect } from "@playwright/test";
import { loginAsPlayer, openFirstVenue, futureDate, toDateInputValue, toDisplayDateValue, widgetDateField, confirmBookingAndReadStatus } from "./helpers";

test.describe("booking flow", () => {
  test("player books an available slot, sees it in My Bookings, then cancels with refund preview", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept()); // window.confirm() on cancel
    await loginAsPlayer(page);

    // Open the first venue from Explore.
    await page.goto("/venues");
    await openFirstVenue(page);
    const widget = page.locator("div.card", { has: page.getByRole("heading", { name: /Đặt sân —/ }) });
    await expect(widget).toBeVisible();

    // Pick a future date and the first enabled slot; confirm the booking.
    // Slots for a newly picked date load asynchronously from
    // /api/availability — wait for the grid to (re)populate before counting.
    // If a previous test run already used (and cancelled) the same slot, the
    // deterministic idempotency key returns that CANCELLED booking — then we
    // move to another slot/day until a fresh booking succeeds.
    const statusBox = widget.locator('[role="status"]');
    let reference = "";
    let booked = false;
    outer: for (let dayShift = 0; dayShift < 3 && !booked; dayShift++) {
      const date = futureDate();
      date.setUTCDate(date.getUTCDate() + dayShift);
      await widgetDateField(widget).fill(toDisplayDateValue(date));
      const slots = widget.locator("div.grid button:not([disabled])");
      await expect(widget.locator("div.grid button").first()).toBeVisible();
      const count = Math.min(await slots.count(), 6);
      for (let i = 0; i < count; i++) {
        await slots.nth(i).click();
        const text = await confirmBookingAndReadStatus(widget, statusBox);
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

  test("with duration 3, a start button displays the 3-hour total (not a per-hour average)", async ({ page }) => {
    await loginAsPlayer(page);
    await page.goto("/venues");
    await openFirstVenue(page);
    const widget = page.locator("div.card", { has: page.getByRole("heading", { name: /Đặt sân —/ }) });
    await expect(widget).toBeVisible();

    // The expectation is computed from the very availability payload the
    // widget fetches for the picked date: the first start whose 3 covered
    // hours are all free must display the SUM of those hours. The old
    // widget divided the sum by the duration and showed an "average
    // hourly price" that exists in no price table.
    let verified = false;
    for (let dayShift = 2; dayShift < 5 && !verified; dayShift++) {
      const date = futureDate();
      date.setUTCDate(date.getUTCDate() + dayShift);
      const iso = toDateInputValue(date);
      const responsePromise = page.waitForResponse(
        (r) => r.url().includes("/api/availability") && r.url().includes(`date=${iso}`) && r.ok(),
      );
      await widgetDateField(widget).fill(toDisplayDateValue(date));
      const avail = (await (await responsePromise).json()) as {
        slots: { price: number; available: boolean }[];
      };
      await widget.getByLabel("Thời lượng").selectOption("3");
      let startIndex = -1;
      let total = 0;
      for (let i = 0; i + 3 <= avail.slots.length; i++) {
        const group = avail.slots.slice(i, i + 3);
        if (group.every((s) => s.available)) {
          startIndex = i;
          total = group.reduce((sum, s) => sum + s.price, 0);
          break;
        }
      }
      if (startIndex < 0) continue; // no fully-free 3h start that day — try the next
      const expected = new Intl.NumberFormat("vi-VN").format(total);
      await expect(widget.locator("div.grid button").nth(startIndex)).toContainText(expected);
      verified = true;
    }
    expect(verified, "expected a fully-available 3-hour start on one of the probed dates").toBe(true);
  });
});
