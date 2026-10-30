import { expect, test } from "@playwright/test";

/**
 * Assistant browser E2E — citation anchors + booking handoff prefill.
 *
 * These tests exercise the REAL browser surfaces the assistant links
 * into (audit F/§9): a citation URL is only honest if the anchored
 * element actually exists on the venue page, and a handoff is only
 * correct if the booking widget opens pre-filled with the server's
 * selection.
 *
 * The assistant API is intercepted with a canned turn that follows
 * the real response contract (the UI renders whatever the API
 * returns; ids used here are derived from the seeded pages
 * themselves). This keeps the browser layer deterministic WITHOUT
 * shipping any mock model provider in the app — model quality is
 * measured separately by eval/ai (scripted + real-model runners).
 */

const VENUE_SLUG = "aurora-sport-cau-long-pickleball-bong-ban";

const APPLIED_CONTEXT = {
  sportSlug: null, district: null, dateISO: null, startTime: null,
  durationHours: null, budgetAmount: null, budgetBasis: null,
  venueIds: [], criteria: [],
};

async function firstReviewAnchor(page: import("@playwright/test").Page): Promise<string> {
  await page.goto(`/venues/${VENUE_SLUG}`);
  const first = page.locator("article[id^='review-']").first();
  await expect(first).toBeVisible();
  const id = await first.getAttribute("id");
  expect(id).toBeTruthy();
  return id!;
}

test.describe("assistant citation anchors", () => {
  test("every rendered Google review carries the anchor its citation URL uses", async ({ page }) => {
    const anchorId = await firstReviewAnchor(page);
    const all = await page.locator("article[id^='review-']").all();
    expect(all.length).toBeGreaterThan(0);
    const ids = await Promise.all(all.map((a) => a.getAttribute("id")));
    expect(new Set(ids).size).toBe(ids.length); // anchors are unique
    // Direct navigation to the citation URL lands on the element.
    await page.goto(`/venues/${VENUE_SLUG}#${anchorId}`);
    await expect(page.locator(`#${anchorId}`)).toBeInViewport();
  });

  test("clicking an assistant evidence citation lands on the anchored review", async ({ page }) => {
    const anchorId = await firstReviewAnchor(page);
    const reviewId = anchorId.replace(/^review-/, "");

    await page.route("**/api/assistant", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          conversationId: "00000000-0000-4000-8000-000000000001",
          answer: {
            type: "review_insight",
            message: "Ánh sáng được khen trong review này.",
            venues: [],
            comparison: null,
            evidence: [
              {
                evidenceId: reviewId,
                venueId: "venue-1",
                venueName: "AURORA SPORT",
                source: "google",
                quote: "Ánh sáng tốt",
                fullText: "Ánh sáng tốt, sân rộng rãi thoáng mát.",
                authorLabel: "Bình",
                rating: 5,
                aspects: ["lighting"],
                sentiment: "positive",
                publishedDate: null,
                relativeTimeRaw: "1 tháng trước",
                contentVersion: "aspect-lex-v1",
                citationTarget: `/venues/${VENUE_SLUG}#${anchorId}`,
              },
            ],
            options: [],
            handoff: null,
            warnings: [],
            missingFields: [],
            appliedContext: APPLIED_CONTEXT,
          },
          history: [],
          contextToken: "e2e-token",
        }),
      });
    });

    await page.goto("/assistant");
    await page.locator("#assistant-input").fill("Sân AURORA ánh sáng thế nào?");
    await page.locator("#assistant-input").press("Enter");
    const details = page.locator("details", { hasText: "Ánh sáng tốt" }).first();
    await expect(details).toBeVisible();
    await details.locator("summary").click();
    await details.locator("a").first().click();
    await expect(page).toHaveURL(new RegExp(`#${anchorId}$`));
    await expect(page.locator(`#${anchorId}`)).toBeInViewport();
  });
});

test.describe("assistant handoff prefill", () => {
  test("the handoff card opens the booking widget pre-filled and creates NO booking", async ({ page }) => {
    // Derive a REAL facility selection from the seeded venue page.
    await page.goto(`/venues/${VENUE_SLUG}`);
    const widget = page.locator("#booking-widget");
    await expect(widget).toBeVisible();
    const facilitySelect = widget.locator("select").first();
    const facilityId = await facilitySelect.inputValue();
    expect(facilityId).toBeTruthy();

    // Next Saturday (YYYY-MM-DD) — availability content is irrelevant
    // here; the assertion is about PREFILL, not about booking.
    const d = new Date();
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    const dateISO = d.toISOString().slice(0, 10);
    const [y, m, day] = dateISO.split("-");
    const dateDisplay = `${day}/${m}/${y}`;
    const bookingUrl = `/venues/${VENUE_SLUG}?facility=${facilityId}&date=${dateISO}&start=18%3A00&duration=2`;

    await page.route("**/api/assistant", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          conversationId: "00000000-0000-4000-8000-000000000002",
          answer: {
            type: "booking_handoff",
            message: "Đây là lựa chọn của bạn — xác nhận trong trang đặt sân nhé.",
            venues: [],
            comparison: null,
            evidence: [],
            options: [],
            handoff: {
              handoffId: "h_e2e",
              venueId: "venue-1",
              venueName: "AURORA SPORT",
              facilityId,
              facilityName: "Sân 1",
              date: dateISO,
              startTime: "18:00",
              endTime: "20:00",
              durationHours: 2,
              totalPrice: 324000,
              priceType: "platform_reference",
              priceStatus: "ok",
              checkedAt: new Date().toISOString(),
              availabilityScope: "sportsHub_demo_schedule",
              policySummary: { fullRefundBeforeHours: 48, partialRefundBeforeHours: 24, partialFeePercent: 30 },
              bookingUrl,
              labels: [],
            },
            warnings: [],
            missingFields: [],
            appliedContext: { ...APPLIED_CONTEXT, dateISO, startTime: "18:00", durationHours: 2 },
          },
          history: [],
          contextToken: "e2e-token",
        }),
      });
    });

    await page.goto("/assistant");
    await page.locator("#assistant-input").fill("Chốt sân này thứ Bảy 18:00, 2 giờ");
    await page.locator("#assistant-input").press("Enter");
    const handoffLink = page.locator(`a[href="${bookingUrl}"]`);
    await expect(handoffLink).toBeVisible();
    await handoffLink.click();
    await expect(page).toHaveURL(new RegExp(`facility=${facilityId}`));

    const widgetAfter = page.locator("#booking-widget");
    await expect(widgetAfter).toBeVisible();
    await expect(widgetAfter.locator("select").first()).toHaveValue(facilityId);
    const dateInput = widgetAfter.locator("input").first();
    await expect(dateInput).toHaveValue(dateDisplay);
    // Prefill alone must not create anything: no navigation to a
    // bookings page and no success state without an explicit confirm.
    await expect(page.locator("text=/đặt sân thành công/i")).toHaveCount(0);
  });
});
