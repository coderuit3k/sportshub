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
   sports-facility website of the same sport — a Vietnamese operator's
   own site wherever one exists — and verified individually before being
   added: HTTP 200 + image content type with this site sent as `Referer`
   (hotlinking must actually work), the response body is a real image,
   and a visual check confirmed a wide shot of the actual court / hall /
   pool (no equipment close-ups, portraits, text-heavy banners or logos).
   Sources: Smash Arena Thủ Đức — Quốc Việt Badminton
   (`qvbadminton.com`, their own HCMC badminton hall); PickleHub Bình
   Thạnh — the Guangzhou Metro Pickleball Center (Wikimedia Commons;
   the namesake club's own site was re-checked in the Oct 2026 audit
   and had no usable wide court photo — its other images are group /
   podium photos, marketing banners and a CCTV still); the pending
   Bình Thạnh venue — Shaheed Tajuddin Ahmad Indoor Stadium, Dhaka
   (Wikimedia Commons; Quốc Việt's second hall photo is dominated by
   a giant brand banner); Hoops Center Thủ Đức — 29 Ballers
   (`29ballers.com`, served from their
   Supabase storage); Aqua Pool Quận 7 — Tôn Đức Thắng University
   (`international.tdtu.edu.vn`; the university's own Quận 7 pool is
   25 m × 13.5 m with 6 lanes, the same spec as the seed venue).
2. **Sport-level pools** (`VENUE_IMAGES`, keyed by sport slug, picked
   deterministically by hashing the venue slug). Each pool holds
   10–13 photos of **real facilities**, so the venues
   of a sport stop repeating the same images: badminton 12 photos,
   pickleball 11, mini football 10, tennis 13, basketball 12,
   swimming 11 — every entry a real-facility photo.
   The real entries are photos of actual courts / halls / pools from
   Vietnamese operator and sports-guide sites where usable shots could
   be verified (Cốc Cốc Badminton via `top3.vn`; HCMC basketball courts
   via `sonsanepoxy.vn`, `thethaothienlong.vn`, `hocbongro.com.vn`) and
   from Wikimedia Commons (named facilities worldwide — e.g. the
   Guangzhou Metro Pickleball Center, Oakmont Tennis Club, Teva Ocean
   Arena, the Australian Institute of Sport pool; files are CC BY /
   CC BY-SA / public domain, credited to
   their Commons authors, served from `thumb.wikimedia.org`). The
   last four legacy stock entries were purged on 2026-10-26: the
   owner had the 10 generated venues whose slug-hash photo picks
   landed on them deleted outright (see `REMOVED_VENUE_SLUGS` in
   `prisma/venue-catalog.ts`), leaving public totals of
   30 / 27 / 27 / 30 / 30 / 26 venues per sport (170 overall). A full visual
   audit in Oct 2026 re-checked every entry as it renders in the
   400×160 card / 800×256 hero crop and replaced anything that read as
   aerial / drone, a broadcast or crowd frame, a portrait or equipment
   close-up, a school / multi-purpose hall, or an unfinished or
   derelict site. Two venues resolve
   here because no usable real-site photo could be verified for them:
   Sài Gòn Mini Football Q7 (candidate operators' own sites served only
   stock ball close-ups and marketing banners) and Riverside Tennis Q1
   (the candidate club site served only stock portraits and text-heavy
   banners). To upgrade one, verify a real facility photo the same way
   and add it to `VENUE_PHOTOS`.

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

Privacy: the position comes from the browser Geolocation API and is
processed **entirely on the client** — coordinates are never sent to
the server, stored, or logged. There is deliberately **no in-page
locate button**: on mount, the component calls
`navigator.geolocation.getCurrentPosition` once, so the browser/device
itself presents the native permission prompt and the section reacts
to the outcome. The initial server render has no position, so it
ranks by rating → price and the full cards are present in the HTML
without JavaScript; while the native prompt is pending, that
default-ranked grid renders with no extra UI (no spinner, no button).
If permission is granted, the grid silently re-ranks with distances
on the cards. If permission is denied, the request times out, or the
API is unsupported, the section simply keeps the default ranking.
Location handling is **fully silent**: no text, banner, or control of
any kind reports the location state — the section shows only the
heading and the card grid.

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

## Caching & rate limiting

Prepared for market traffic: cut repeated database reads on the public
pages and make the abuse brakes global. Two mechanisms, deliberately
kept apart:

### Page/data caching (`src/lib/public-data.ts`)

The public pages declare their freshness intent with
`export const revalidate` (home `/`: 300 s, venue detail
`/venues/[slug]`: 300 s), but the actual read reduction happens one
layer down, in `unstable_cache` data functions:

| Data | TTL | Tag |
| --- | --- | --- |
| Homepage sports + featured venues | 300 s | `venues` |
| Homepage open sessions ("from today") | 300 s | `sessions` |
| Venue detail payload (incl. reviews) | 300 s | `venues` |
| `/venues` filtered list (keyed by the normalized filter set) | 60 s | `venues` |
| `/venues` filter sidebar (sports + districts) | 60 s | `venues` |

Cached payloads are plain serializable DTOs (dates cross the cache as
ISO strings / epoch numbers). Consequences, all deliberate:

- **Reviews can lag up to 5 minutes** on the venue page; the homepage
  "from today" session boundary can lag up to 5 minutes past midnight.
  Slot *availability* is NOT cached — the detail page still computes it
  live per request, and booking creation re-validates server-side.
- **Invalidation:** admin venue approve/reject
  (`POST /api/admin/venues/[id]`) calls `revalidateTag("venues")` plus
  `revalidatePath` for `/`, `/venues`, and the venue's own page, so a
  visibility change is reflected immediately; TTL expiry is the
  backstop for everything else. (There is no review-creation endpoint —
  reviews are seed data — so no other mutation invalidates today.)

**Favorites hydration.** Because the payloads above are user-less, the
home and venue-detail pages render favorite state as "off". After
mount, hearts/buttons hydrate from `GET /api/me/favorites`
(`src/components/use-favorites.ts` — one shared fetch per page load).
The endpoint always answers 200: `{ authenticated: false, venueIds: [] }`
for anonymous visitors (nothing sensitive to protect, no client error
handling needed), `{ authenticated: true, venueIds: [...] }` when
signed in. Anonymous visitors see the login link on the detail page
once hydration resolves; toggling still uses `POST /api/favorites`
unchanged. `/venues` and `/favorites` keep their per-request
server-rendered favorite state.

**Locale × cache verdict (verified 2026-10-25).** One risk was checked
explicitly: with cookie-based i18n, could a route cache bake one
visitor's language into another's response? It cannot happen here —
the locale lookup (`cookies()` inside `getRequestConfig`) makes Next
bail out of static generation, so `/` and `/venues/[slug]` build as
dynamic (ƒ) routes and every response is rendered per-request in the
visitor's own locale; the `revalidate` exports are inert freshness
declarations today. The runtime matrix against the production build —
`/` and a venue detail requested as `en → vi (no cookie) → en`, each
response's `<html lang>` and copy checked — passed with zero
cross-locale bleed, and the i18n E2E exercises both locales
repeatedly against the same build. The trade-off is accepted and
documented: no full-route HTML caching for these pages (per-request
render + data cache instead). If the locale ever moves into the URL,
the same `revalidate` values will govern real ISR — re-run the locale
matrix before relying on that.

### Rate limiting (`src/lib/rate-limit.ts`)

One async surface — `check` / `record` / `consume` / `reset` — with two
backends, chosen per limiter at first use:

- **Upstash (shared/global)** when `KV_REST_API_URL` and
  `KV_REST_API_TOKEN` are set — the variable names injected by the
  Vercel Marketplace Upstash/Redis integration (Vercel KV speaks the
  Upstash REST protocol, so `@upstash/redis` connects directly).
  Implemented as direct fixed-window counters on raw Redis commands —
  one key per limiter+subject, `rl:{prefix}:{key}`: `record` is `INCR`
  (+ `PEXPIRE` to the window on the first hit, anchoring the window),
  `check` is a `GET` peek (with `PTTL` sizing the retry delay when
  denied), `consume` is `INCR`-first so concurrent consumers cannot
  overshoot the quota, `reset` is `DEL`. Delta vs the in-memory
  limiter: the Redis window is FIXED (anchored at the first attempt)
  rather than an exact sliding log; quotas are the same. (An earlier
  iteration delegated counting to `@upstash/ratelimit`'s sliding
  window; it was removed after production probes showed the limiters
  never blocking — every Redis error was swallowed by bare `catch {}`
  blocks and silently degraded to per-instance memory, leaving no
  observable signal. The direct-counter implementation logs every
  Redis error and exposes its state instead — see below.)
- **In-memory (fallback)** otherwise: the original per-instance
  limiter — fine for local dev; on serverless the effective limit is
  roughly `limit × instances`. A one-time warning is logged when this
  fallback is active with `NODE_ENV=production`.

**Failure observability.** If a Redis call errors, the error is logged
(`console.error("[rate-limit] redis error", …)`, message only) and
that call degrades to the in-memory backend instead of failing the
request — availability over strictness, but never silently. Each
limiter exposes `diagnostics()` → `{ configured, degradedLastCall }`
for tests and internal inspection.

**Production verification (2026-10-25): passed.** With the shared
Redis backend live, the per-user booking limiter was driven to its
quota from production traffic across serverless instances: the
remaining counter decremented globally (30 → 0) and the 31st attempt
returned 429 — proof the counters are global in Redis rather than
per-instance memory. (Temporary diagnostic response headers used to
obtain this proof were removed after verification.)

Quotas (unchanged): login 10 **failed** attempts / 10 min per IP+email
(reset on success), register 5 / hour per IP, booking 30 / 10 min
per user.

**Activating Upstash (production):**

1. Add the Upstash/Redis integration from the Vercel Marketplace
   (Storage tab) to the project — it provisions the database and
   injects the credentials automatically.
2. The integration sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   (Production scope) — these are the variables the code reads.
3. Redeploy. No code change is needed — the limiters pick the backend
   up from the environment, and the startup log line
   `[rate-limit] backend: upstash` confirms it in the deployment logs.
   Until then, the in-memory fallback keeps working exactly as before.

### Remaining limits

- No full-route/edge HTML cache for `/` and `/venues/[slug]` (see the
  locale verdict above) — mitigated by the data cache, Prisma query
  shapes, and per-request rendering being cheap once data is cached.
- `/venues` beyond the 60 s data cache and per-user pages
  (`/my-bookings`, `/favorites`, …) are uncached by design.
- Rate limiting is fail-open to per-instance memory during an Upstash
  outage (availability chosen over strictness, deliberately).
