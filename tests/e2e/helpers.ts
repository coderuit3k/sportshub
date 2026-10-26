import { expect, type Page } from "@playwright/test";

/** Seeded local-dev accounts (see prisma/seed.ts / README — local only). */
export const PLAYER = { email: "player@sportshub.local", password: "Password123!" };
export const ADMIN = { email: "admin@sportshub.local", password: "Password123!" };

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  // Header switches to the logged-in state (logout button + user links).
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
}

export function loginAsPlayer(page: Page): Promise<void> {
  return login(page, PLAYER.email, PLAYER.password);
}

/**
 * Click the booking widget's confirm button and return the status message
 * produced by THAT submission. Two traps make a naive read unreliable:
 * (1) the widget keeps the previous attempt's message on screen until the
 * new POST resolves, so an early read can pick up a stale result (e.g. an
 * earlier idempotent CANCELLED) and misjudge a fresh booking;
 * (2) while the POST is in flight the widget clears the message entirely,
 * so "" must not count as "the new message" either.
 * We therefore wait for a NON-EMPTY message that differs from the previous
 * one before reading it.
 */
export async function confirmBookingAndReadStatus(
  widget: ReturnType<Page["locator"]>,
  statusBox: ReturnType<Page["locator"]>,
): Promise<string> {
  const before = (await statusBox.allTextContents()).join("");
  await widget.getByRole("button", { name: "Xác nhận đặt sân" }).click();
  await expect
    .poll(
      async () => {
        const t = (await statusBox.allTextContents()).join("");
        return t !== "" && t !== before ? t : "";
      },
      { timeout: 10_000 },
    )
    .not.toBe("")
    .catch(() => {});
  return (await statusBox.allTextContents()).join("");
}

/**
 * Open the first venue from /venues via its card link.
 * The click can race SSR hydration on a loaded machine: if React replaces
 * the anchor node between mousedown and mouseup, the click event never
 * fires and no navigation starts (observed intermittently in this suite —
 * no console error, a later click always lands). Try a real click first
 * (exercises SPA navigation); if the URL doesn't change, fall back to a
 * direct goto of the same href — these specs verify the booking flow, not
 * the router, and must not flake on hydration timing.
 */
export async function openFirstVenue(page: Page): Promise<void> {
  const venueLink = page.locator('article h3 a[href^="/venues/"]').first();
  await expect(venueLink).toBeVisible();
  const href = await venueLink.getAttribute("href");
  await venueLink.click();
  try {
    await page.waitForURL(/\/venues\/.+/, { timeout: 8_000 });
    return;
  } catch {
    if (!href) throw new Error("venue link has no href and click navigation did not start");
    await page.goto(href);
  }
}

/**
 * Calendar-date helpers anchored to Asia/Ho_Chi_Minh (the business
 * timezone): the date the test writes into the date field must be the
 * same Saigon calendar date no matter what TZ the test runner/browser uses.
 */
const saigonParts = (d: Date) => {
  const map: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
};

/** Format a Date as its yyyy-mm-dd calendar date in Asia/Ho_Chi_Minh (ISO, the value dates travel as). */
export function toDateInputValue(d: Date): string {
  const { year, month, day } = saigonParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Rearrange an ISO yyyy-mm-dd into the dd/MM/yyyy the DateField displays and accepts. */
export function isoToDisplayDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Format a Date as dd/MM/yyyy (Saigon) — what tests type into the DateField. */
export function toDisplayDateValue(d: Date): string {
  return isoToDisplayDate(toDateInputValue(d));
}

/** The booking widget's date field (DateField text input, placeholder dd/MM/yyyy). */
export function widgetDateField(widget: ReturnType<Page["locator"]>) {
  return widget.getByPlaceholder("dd/MM/yyyy");
}

/**
 * A future Saigon calendar date 7–16 days out. The day offset rotates with
 * the calendar day so repeated local runs don't keep colliding with the
 * booking widget's deterministic idempotency key (date + slot) from
 * earlier runs.
 */
export function futureDate(): Date {
  const { year, month, day } = saigonParts(new Date());
  const rotate = Math.floor(Date.now() / 86_400_000) % 10;
  return new Date(Date.UTC(year, month - 1, day + 7 + rotate));
}

/**
 * "YYYY-MM-DD" (Saigon) of a coming Saturday: the next Saturday at least
 * 6 days out, plus `weeksAhead` extra weeks. Used by the timezone
 * regression spec, which needs a guaranteed-weekend date.
 */
export function saturdayDateISO(weeksAhead = 0): string {
  const { year, month, day } = saigonParts(new Date());
  const base = new Date(Date.UTC(year, month - 1, day));
  const dow = base.getUTCDay(); // weekday of the Saigon calendar date itself
  const untilSaturday = ((6 - dow + 7) % 7) + 7; // 7–13 days out
  base.setUTCDate(base.getUTCDate() + untilSaturday + weeksAhead * 7);
  return toDateInputValue(base);
}
