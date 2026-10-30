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
prisma/           # schema.prisma (PostgreSQL), seed.ts, booking-constraint.ts
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
hero) show a real photo of the venue's sport. The display chain is
implemented by `resolveVenueDisplayImage` in `src/lib/venue-images.ts`
(the public DTOs in `src/lib/public-data.ts` carry the stored URL as
`imageUrl`, computed by `storedPrimaryImageUrl`; `VenueImage` tries the
candidates in order and falls through on a load error). Lookup order:

1. **The venue's stored primary photo** — the first `VenueImage` row
   (by `sortOrder`) whose `url` is an http(s) URL; `gradient:*` rows are
   placeholders, not photos. Stored photos live in the project's
   Cloudflare R2 bucket (see "Image storage" below): the curated photos
   are copied there by a deploy-time migration, and owners can replace
   the photo with their own upload. This level wins whenever present.
2. **The code map** (`venueImage(sportSlug, venueSlug)` — no API key,
   no runtime API calls): per-venue overrides first, then the
   sport-level pools, detailed in the two numbered sections below.
3. **Gradient + sport emoji** when neither level has a photo, or every
   candidate fails to load.

The code map itself resolves as:

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

### Image storage — Cloudflare R2

Stored photos (display level 1 above) live in a **Cloudflare R2**
bucket (S3-compatible object storage), accessed through the single
shared module `src/lib/storage/r2.ts` (`@aws-sdk/client-s3`, endpoint
`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`, region `auto`).
Nothing else in the codebase talks to R2 directly.

**Layout.** One bucket, one key prefix: the migrated curated photo
of a venue is `venue-photos/<venueSlug>.jpg` (deterministic, so
re-runs overwrite in place); an owner upload is
`venue-photos/<venueSlug>-<timestamp>.<ext>`. The public URL stored
on the venue's primary `VenueImage` row is
`<R2_PUBLIC_BASE_URL>/<key>`; the host of `R2_PUBLIC_BASE_URL` is
allowlisted in `next.config.ts` at config time (falling back to
`*.r2.dev` before the bucket exists).

**Configuration.** Storage is configured only when ALL five env vars
are present: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`. They are
set in the Vercel project by the owner (checklist below) — **secrets
live in the Vercel dashboard only, never in code, chat, or this
repo.** The code shipped before the bucket exists on purpose, so
every consumer handles "not configured" gracefully and nothing
crashes: the migration logs a skip and succeeds, the presign route
answers 503 with code `STORAGE_NOT_CONFIGURED`, the owner page reads
the flag server-side and the upload section renders a disabled
"chưa bật kho lưu trữ ảnh" explanation, and display falls back to
the code map exactly as before.

**Migration.** `prisma/photo-migration.ts` runs inside
`prisma/deploy-db.ts` after the catalog ensure: for every venue
whose code-map photo exists and whose primary `VenueImage` row is
missing, a `gradient:*` placeholder, or not yet under
`R2_PUBLIC_BASE_URL`, it downloads the photo (with our site as
Referer), `PutObject`s it to the deterministic key, and stores the
public URL on the row. The step is idempotent (rows already under
the public base are skipped — a second run migrates 0) and **never
throws**: a failed download or upload is logged loudly, counted in
the end summary, and leaves the row as-is — the external URL still
displays and the next build retries. All HTTP/S3 work happens
outside DB transactions (the catalog TX_OPTIONS lesson).

**Owner uploads.** The "Ảnh sân" section of the owner dashboard
(`src/components/VenuePhotoManager.tsx`, rendered per venue in
`/owner`) runs a three-step flow: (1) `POST
/api/owner/venue-photo/upload` — the *presign* route — verifies the
session user owns the venue, is staff on it, or is ADMIN (the shared
rule in `src/lib/venue-photos/access.ts`), validates the declared
type (JPEG/PNG/WebP) and size (≤ 8 MB), and returns a presigned
`PutObject` URL (300 s expiry) plus the final public URL; (2) the
browser PUTs the file directly to R2 with progress; (3) `POST
/api/owner/venue-photo` re-verifies ownership and that the URL is
under `R2_PUBLIC_BASE_URL`, then upserts the primary row — the photo
displays immediately (the public-data caches pick it up via their
normal TTL/tag rules). `DELETE /api/owner/venue-photo` reverts the
primary row to the `gradient:*` placeholder (back to the code-map
default) and best-effort `DeleteObject`s the stored object.
Rate limiting (see "Rate limiting" below): the presign route
performs no write itself, so it is covered by the global per-IP net
only; persist/remove are claimed by the generic write bucket.

**Owner setup checklist** (one-time, in the Cloudflare + Vercel
dashboards):

1. Create a Cloudflare account and enable **R2** (a payment card may
   be required even for the free tier).
2. Create a bucket (e.g. `sportshub-photos`).
3. In the bucket's **Settings**: enable public access via the
   **r2.dev subdomain** — the resulting `https://pub-….r2.dev` URL
   is `R2_PUBLIC_BASE_URL` — and add a **CORS policy** allowing
   `PUT` and `GET` from `https://sportshub-pi-five.vercel.app`
   (browser direct uploads are cross-origin PUTs).
4. Under R2 → **Manage API tokens**, create a token with **Object
   Read & Write** permission scoped to this bucket only; note the
   access key id + secret and your account id.
5. In the Vercel project → Settings → Environment Variables
   (Production), set all five: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`.
6. Redeploy — the build's migration step copies the curated photos
   into the bucket on that deploy, and the owner upload section
   turns on.

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

Quotas for the original three buckets (unchanged): login 10 **failed**
attempts / 10 min per IP+email (reset on success), register 5 / hour
per IP, booking 30 / 10 min per user.

**Extension (2026-10-26): the whole API is covered.** Every route under
`src/app/api` now sits behind two layers:

1. **Global safety net (middleware).** `src/middleware.ts` matches
   `/api/:path*` and consumes `apiGlobalLimiter` — 600 requests / 10 min
   per IP — before any handler runs; `/api/health` is exempt (uptime
   probes must never be throttled). Middleware was chosen over wiring a
   guard into each handler because it is the only layer that covers
   `/api/*` *totally, by construction* — a future route is covered the
   moment it exists. It calls the same limiter facade as the handlers,
   so the failure semantics are identical: a Redis error logs loudly
   and degrades that call to per-instance memory rather than failing
   the request. The API branch returns before the page auth guard, so
   API requests are never redirected to `/login` (handlers answer their
   own 401 JSON). Headroom check: a normal page load fans out to ~1 API
   call (`GET /api/me/favorites`, one shared fetch per page) plus
   booking-widget availability fetches on interaction — even a shared
   NAT IP with several active users stays far below 600 / 10 min.
2. **Per-user write buckets (handlers).** Each mutation route is
   claimed by exactly ONE per-user bucket. Routes with a specific
   bucket are NOT also counted into the generic bucket — the specific
   quota is the binding constraint, and stacking would silently shrink
   it (booking keeps its full 30 / 10 min). Only the per-IP global net
   stacks, by design.

| Bucket | Quota | Key | Routes |
| --- | --- | --- | --- |
| Global API net | 600 / 10 min | IP | ALL `/api/*` except `/api/health` (middleware) |
| Login | 10 **failed** / 10 min | IP + email | `POST /api/auth/login` |
| Register | 5 / hour | IP | `POST /api/auth/register` |
| Booking create | 30 / 10 min | user | `POST /api/bookings` |
| Session create | 10 / hour | user | `POST /api/sessions` |
| Session join/leave | 30 / 10 min | user | `POST /api/sessions/[id]/join` |
| Review create | 10 / hour | user | *reserved — no endpoint exists yet* |
| Password change | 5 / hour | user | `POST /api/profile/change-password` |
| Generic write | 60 / 10 min | user | `POST /api/bookings/[id]/action`, `POST /api/favorites`, `PATCH /api/profile`, `POST /api/admin/users/[id]`, `POST /api/admin/venues/[id]`, `POST`+`DELETE /api/owner/venue-photo` |

Route-coverage summary (all 17 routes): the three read-only GETs
(`/api/availability`, `/api/me/favorites`) rely on the global net;
`/api/health` is fully exempt; two mutations have no per-user bucket
— `POST /api/auth/logout` (it must work with an expired or absent
session, so there is no trustworthy user id to key on) and `POST
/api/owner/venue-photo/upload` (the R2 presign route: it only issues
a presigned PUT URL, the file bytes go browser → R2, and the actual
database write is the persist route's, which IS in the generic
bucket). The global net covers both. Admin mutations are deliberately NOT exempt —
they drain the acting admin's generic write bucket. There is still no
review-creation endpoint (reviews are seed data), so `reviewCreateLimiter`
is defined and unit-tested but intentionally unattached; wiring it is a
one-line addition when the route lands. `tests/rate-limit-coverage.test.ts`
pins this table: it discovers every route under `src/app/api`, fails if
one is missing from the manifest, and verifies each claimed bucket is
actually imported and consumed by its handler.

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
