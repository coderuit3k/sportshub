# Architecture

```
src/
  app/            # App Router pages + API route handlers
    (pages)       # /, /venues, /venues/[slug], /my-bookings, /community,
                  # /profile, /favorites, /notifications, /owner, /admin, /login, /register
    api/          # auth, bookings (+[id]/action), availability, favorites, sessions (+[id]/join),
                  # admin/venues/[id], profile
  components/     # Header, VenueCard, client-widgets (booking widget, action buttons, join, favorite)
  services/       # bookings.ts — availability, transactional booking creation, transitions
  lib/
    auth.ts       # bcryptjs + jose JWT session cookie, getCurrentUser, RBAC helpers
    db.ts         # shared Prisma client
    booking/logic.ts  # PURE logic: price, refund, overlap, transitions, capacity (unit-tested)
    time/tz.ts    # business-timezone helpers (Asia/Ho_Chi_Minh) — see "Timezone" below
    payments/     # provider abstraction — SimulatedPaymentProvider only
    notifications.ts  # in-app notifications with dedupeKey
  middleware.ts   # protects /my-bookings, /profile, /owner, /admin, /favorites, /notifications; role gates
prisma/           # schema.prisma (SQLite), schema.postgresql.prisma, seed.ts
tests/            # Vitest unit tests for pure logic
```

Principles: Server Components by default; business logic in the service layer, never only in components; all prices computed server-side from `PriceRule`; authorization checked server-side on every mutation (middleware is a first gate, route handlers re-check ownership/role).

## Timezone

The business timezone is **Asia/Ho_Chi_Minh**. All booking math is anchored to
it, regardless of the timezone of the machine the code runs on:

- Price rules are matched by the Saigon wall clock: weekday (weekend rule) and
  hour (peak/off-peak) of each slot are read via `src/lib/time/tz.ts`
  (Intl-based), never via process-local `Date.getDay()` / `getHours()`.
- `getAvailability(facilityId, dateISO)` takes a plain calendar date
  (`YYYY-MM-DD`) meaning that date in Saigon. Operating hours are looked up by
  that date's weekday, day boundaries are Saigon midnights, and slots are
  Saigon wall-clock times converted to UTC instants.
- The client never constructs instants from date strings: the booking widget
  receives slot instants from the server (initial render, or
  `GET /api/availability?facilityId=…&date=YYYY-MM-DD` for other dates) and
  displays the server-provided Saigon `HH:MM` label. User-typed wall times
  (e.g. the community session form's `datetime-local`) are anchored with
  `saigonDateTimeToInstant`, not `new Date(str)`.
- All user-facing date/time rendering passes `timeZone: "Asia/Ho_Chi_Minh"`
  explicitly (e.g. My Bookings, community, owner/admin lists).

Why: production (Vercel) runs with a UTC process timezone. Booking logic that
read process-local time stored a "Saturday 14:00" pick as 14:00Z
(= 21:00 Saigon) and priced it against the wrong wall clock. Regression
coverage: `tests/tz.test.ts`, the timezone block in
`tests/booking-logic.test.ts` (the unit suite is run under both `TZ=UTC` and
`TZ=Asia/Ho_Chi_Minh`), and `tests/e2e/timezone.spec.ts` (Saturday 14:00 →
weekend price, rendered back as 14:00–15:00 in My Bookings).

## Venue photos

Venue banners (cards on `/`, `/venues`, `/favorites`, and the detail-page
hero) show a real photo of the venue's sport, resolved by
`venueImage(sportSlug, venueSlug)` in `src/lib/venue-images.ts` — no API
key, no runtime API calls, no DB column. Lookup order:

1. **Per-venue photo from a real facility website** (`VENUE_PHOTOS`,
   keyed by venue slug). Each seed venue's photo was sourced from a real
   Vietnamese sports-facility website of the same sport — the operator's
   own site wherever one exists — and verified individually before being
   added: HTTP 200 + image content type with this site sent as `Referer`
   (hotlinking must actually work), the response body is a real image,
   and a visual check confirmed a wide shot of the actual court / hall /
   pool (no equipment close-ups, portraits, text-heavy banners or logos).
   Sources: Smash Arena Thủ Đức and the pending Bình Thạnh venue —
   Quốc Việt Badminton (`qvbadminton.com`, their own HCMC badminton
   halls); PickleHub Bình Thạnh — CLB Pickleball Trung Đoàn Gia Định
   (`pickleballtrungdoangiadinh.com`, the club's own site, HTTP-only);
   Hoops Center Thủ Đức — 29 Ballers (`29ballers.com`, served from their
   Supabase storage); Aqua Pool Quận 7 — Tôn Đức Thắng University
   (`international.tdtu.edu.vn`; the university's own Quận 7 pool is
   25 m × 13.5 m with 6 lanes, the same spec as the seed venue).
2. **Sport-level stock fallback** (`VENUE_IMAGES`, Unsplash / Pexels CDN
   links, verified the same way), picked deterministically by hashing
   the venue slug. Two venues currently resolve here because no usable
   real-site photo could be verified for them: Sài Gòn Mini Football Q7
   (candidate operators' own sites served only stock ball close-ups and
   marketing banners) and Riverside Tennis Q1 (the candidate club site
   served only stock portraits and text-heavy banners). To upgrade one,
   verify a real facility photo the same way and add it to
   `VENUE_PHOTOS`.

Every host used above is allowlisted in `next.config.ts`
(`images.remotePatterns`). Fallback: a venue with no photo at either
level, or an image that fails to load, renders the original gradient
banner with the sport emoji instead — implemented in
`src/components/VenueImage.tsx`, so a frame never renders broken or
empty. The pixel-level guard is `tests/e2e/venue-images.spec.ts`: every
card and hero must render with `naturalWidth > 0` and a real height.

## Geolocation ranking

The homepage "Sân nổi bật" (featured venues) section
(`src/components/FeaturedVenues.tsx`) ranks venues by, in strict
priority order:

1. **star rating** (`ratingAvg`, descending)
2. **distance** from the visitor's position (ascending)
3. **price** (`minPrice`, ascending)

The pure ranking logic lives in `src/lib/geo/rank.ts` (`haversineKm`,
`rankVenues`, `formatDistance`; unit tests in `tests/geo-rank.test.ts`,
browser coverage in `tests/e2e/geolocation.spec.ts`). Venues without
coordinates count as infinitely far, venues without a price as
infinitely expensive; a full tie keeps the incoming order (stable sort).

Privacy: the position comes from the browser Geolocation API, only
after the visitor clicks "Dùng vị trí của tôi", and is processed
**entirely on the client** — coordinates are never sent to the server,
stored, or logged. The initial server render has no position, so it
ranks by rating → price and the full cards are present in the HTML
without JavaScript. If permission is denied, the request times out, or
the API is unsupported, the section keeps that default ranking and
shows a short note ("Không lấy được vị trí — danh sách đang xếp theo
đánh giá và giá."); the visitor can also turn location off again
("Tắt vị trí") to return to the default order.

## Internationalization (i18n)

The UI is bilingual **vi (default) / en** via **next-intl**, with a
cookie-based locale and **no URL restructuring**:

- `src/i18n/request.ts` (`getRequestConfig`) reads the locale from the
  `NEXT_LOCALE` cookie (falling back to `vi` for missing/invalid
  values) and loads `messages/<locale>.json`. `next.config.ts` is
  wrapped with `createNextIntlPlugin`; there is deliberately **no**
  locale middleware/routing.
- The navbar `LanguageSwitcher` (`src/components/LanguageSwitcher.tsx`,
  visible in both the desktop and mobile nav) sets the cookie
  (path=/, 1 year, sameSite=lax) and reloads the page. A hard reload is
  used on purpose: `router.refresh()` does not patch `<html lang>`,
  which the root layout renders from the active locale.
- The root layout sets `<html lang={locale}>` and wraps the app in
  `NextIntlClientProvider`. Datetimes render through next-intl's
  formatter with the shared options in `src/i18n/format.ts` (Saigon
  wall clock in both locales); prices via `formatVND(amount, locale)`
  ("160.000 đ" vs "160,000 VND"); distances via
  `formatDistance(km, locale)` ("2,3 km" vs "2.3 km").

Dictionaries live in `messages/vi.json` + `messages/en.json`, namespaced
by area (`nav`, `footer`, `home`, `venues`, `venueDetail`, `booking`,
`community`, `auth`, `account`, `common`, `sports`, `amenities`).
**Adding a string:** add the key to *both* files (vi = the product
copy, en = its translation) and read it with `useTranslations` /
`getTranslations`. `tests/i18n-parity.test.ts` fails the unit suite if
the key sets or ICU placeholders drift apart.

Coverage: navbar + footer, homepage (hero/search/sports/featured +
geolocation UI/sessions/CTA), `/venues`, venue detail + booking widget,
`/community` + create-session form, `/login` + `/register`,
`/my-bookings`, `/favorites`, `/notifications`, `/profile`, and the
404/error/loading chrome. Closed vocabularies are dictionary-driven:
sport names by slug and the five seeded amenity names (see
`src/i18n/vocab.ts`); anything unknown renders as stored.

Known gaps (deliberate, this round):

- **Owner and admin dashboards' inner pages stay Vietnamese** (the
  shared nav/footer around them translate; shared widgets like the
  booking action buttons translate everywhere they appear).
- **API-returned error strings stay Vietnamese** — server routes return
  Vietnamese `error` messages which the UI displays verbatim; only
  client-side fallback/success messages are localized.
- **DB content is not translated**: venue names/descriptions, reviews,
  session titles/descriptions, notifications, and facility surface
  labels render as stored.
- Page `<title>` metadata strings are not localized yet.
