# SportsHub — Vietnam Sports Discovery, Booking & Community Platform

Discover, book and play: real sports venues across Ho Chi Minh City with live
availability, server-side pricing, community match sessions ("Play Together"),
owner/admin consoles, and a conversational AI assistant that searches venues,
explains reviews, checks schedules and prepares bookings.

**Live:** https://sportshub-pi-five.vercel.app

> ⚠️ Payments are **SIMULATED only** — no real money moves, and every Payment
> record is labelled `SIMULATED`. Outbound email is likewise simulated
> (in-app notifications are real). A real payment/email provider is the main
> remaining step before a commercial launch, together with a paid Vercel
> plan and a custom domain.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript strict + Tailwind CSS 3
- Prisma ORM **6.19.3 (pinned exactly)** — PostgreSQL for local dev, tests and
  in production (`prisma/schema.postgresql.prisma`, hosted on Neon,
  Singapore region). The pin matters: Prisma 7's CLI rejects this schema's
  datasource syntax, so do not "upgrade" the CLI casually.
- Auth: bcryptjs + `jose` JWT in an httpOnly cookie. RBAC: `PLAYER` / `OWNER` / `ADMIN`
- Maps: Leaflet over OpenStreetMap raster tiles (no API key, no WebGL)
- Venue photo storage: Cloudflare R2 (S3-compatible, presigned uploads)
- Rate limiting: Upstash Redis (Vercel KV) with a per-instance in-memory fallback
- AI: Amazon Bedrock (Claude Haiku 4.5) via the Converse API; an
  OpenAI-compatible provider is available by configuration
- i18n: Vietnamese (default) + English, persisted by cookie, URLs unchanged
- Design tokens: primary `#0F5132`, secondary `#10B981`, accent `#F59E0B`;
  fonts Plus Jakarta Sans + Inter. Currency VND, business timezone Asia/Ho_Chi_Minh

## The catalog: real venues, real Google ratings

The catalog is **119 real HCMC venues** — 20 per sport across badminton,
pickleball, mini football, tennis, basketball and swimming (one venue lists
in two sports, hence 119 unique venues for 120 sport listings). Each venue
carries its real **Google rating and rating count**, shown with a "Google
reviews" source label, plus a selection of its Google review texts
(604 in total) on the detail page. SportsHub's own in-app ratings are tracked
separately and never merged into the Google figures.

The catalog is data-as-code and self-healing:

- `prisma/real-venues-data.ts` — the venue set (name, address, coordinates, Google aggregates)
- `prisma/real-reviews-data.ts` — the Google review texts, keyed by venue slug
- `prisma/real-catalog.ts` — `ensureRealCatalog()` runs on **every production
  build** (via `prisma/deploy-db.ts`): it retires sample venues and stale
  Google venues only when they have no bookings. Owner-created venues and
  all booking records are preserved; a blocked retirement fails the build
  loudly. It then re-syncs catalog venues and reviews.
  The same step ends `prisma/seed.ts`, so a fresh local DB converges to the
  identical catalog.

Rating filters use the *effective* rating (`googleRating ?? in-app ratingAvg`)
consistently across list, map and featured ranking. For imported venues,
prices are **platform reference prices** (not owner-confirmed) and
facilities/opening hours are platform-normalized defaults — the UI and the
AI assistant label them as such.

## Features

**Discovery**
- Home with featured venues (ranked by rating, then distance, then price —
  distance is computed in the browser only and never sent to the server)
- Venue explore with combinable filters (sport, district, price, rating,
  amenities) as URL params; list **and** map views sharing one filter set
- Venue detail: photo gallery, facility ("sân con") cards with quick-book,
  live availability grid (past and booked slots visibly locked), Leaflet map
  + Google Maps directions link, Google reviews section
- Favorites with optimistic hearts; full vi/en language switch

**Booking**
- 3-step booking widget, dd/MM/yyyy date field, per-slot totals for the
  chosen duration, live grid refresh after booking
- Server-side pricing rules (off-peak / peak / weekend), transactional
  double-booking prevention backed by a PostgreSQL `tsrange` exclusion
  constraint, idempotent booking creation
- Cancellation with refunds computed from the policy snapshot stored on the
  booking; My Bookings with status tabs

**Community — Play Together**
- Open match sessions per venue: create, join, leave, capacity and
  duplicate-join prevention

**Owner console**
- Dashboard stats, venue management, booking approve/reject,
  photo uploads straight to R2 via presigned URLs

**Admin console**
- Venue approval queue, user management (grant/revoke roles including
  ADMIN, reset password, lock account — self-demotion blocked), audit log

**Platform**
- Rate limiting on auth, booking and API writes (429 + `Retry-After`,
  `{ code: "RATE_LIMITED" }` contract)
- Cached public reads (`unstable_cache` DTOs in `src/lib/public-data.ts`)
- `GET /api/health` readiness probe (503 when the DB is unreachable)
- Branded 404 / error / loading pages, sitemap + robots

## AI assistant (`/assistant`)

A Vietnamese multi-turn agent that follows the demo flow — *state a need →
find venues → explain with review evidence → check schedule & quote →
hand off to the booking UI* — over seven typed, **read-only** tools:
`search_venues`, `get_venue_profile`, `search_review_evidence`,
`get_review_summary_stats`, `get_bookable_options`,
`compare_venue_options`, `prepare_booking_handoff`.

Trust model (enforced in code, not just the prompt):

- The assistant **never creates a booking**. It prepares a handoff card;
  the user confirms in the existing booking widget.
- Answers are validated and hydrated server-side from tool results —
  venue/evidence/option/handoff IDs the model invents are rejected.
- Google aggregates, stored Google review texts and in-app reviews are
  three separate populations, never blended; statistics always carry a
  numerator / denominator / scope. Prices are labelled platform
  reference prices; availability is labelled as the SportsHub demo
  schedule.
- Server-side guards added from live evaluation (prompt
  `sportshub-assistant-v6`): a **stats guard** (review counts require a
  successful stats call in the same turn), a **slot-check guard** (a
  complete date/time/duration in state requires a real
  availability/price check before a shortlist can finalize), a
  **shortlist auto-fill** (options verified by tools reach the UI even
  when the model forgets to reference them), and a prescribed
  **handoff recovery** (profile lookup → one retry).
- Audit hardening (prompt v7): **grounding checks** reject prose
  numbers with no tool fact behind them and stop citations being
  used across venues/aspects; conversations are **scoped to a
  server-derived principal** (session user or signed anonymous
  cookie) with signed client-context tokens — a conversationId alone
  grants nothing; composite comparisons report per-venue outcomes
  (`unknown_due_to_error` / `price_unavailable`) instead of turning
  tool errors into "no slots". See `docs/ai-evaluation.md` §6.
- Evaluation: scripted benchmark **50/50** (tools/protocol/no-write
  invariant) and a 10-case **live production battery** (real model,
  real data) whose findings drove the guards above — see
  `eval/ai/live-eval-2026-10-28.md` and `docs/ai-evaluation.md`.
  Known weakness: a full search + compare turn takes ~35 s.
- Provider: **Amazon Bedrock**, Claude Haiku 4.5. The bare model ID
  `anthropic.claude-haiku-4-5-20251001-v1:0` resolves to the region's
  inference profile automatically. Kill switch: `AI_ASSISTANT_ENABLED=false`.
- Docs: `docs/ai-assistant.md`, `docs/ai-tools.md`,
  `docs/ai-evaluation.md`, `docs/ai-demo-runbook.md`

## PostGIS radius search (PostgreSQL only)

With PostgreSQL + PostGIS, queries like *"venues within 5 km"* run in
SQL over venue coordinates. Design note: only the `postgis` extension
is installed — the geography point is computed **inline** from
latitude/longitude in each query, deliberately *not* stored as a
column, so it can never drift from the coordinates (a generated column
also breaks `prisma db push`). At catalog scale (~119 venues) the lack
of a GiST index is irrelevant.

```bash
npm run db:postgis   # CREATE EXTENSION IF NOT EXISTS postgis + status
npm run venues:near -- --lat 10.8503 --lng 106.7553 --radius 5
npm run venues:near -- --lat 10.8503 --lng 106.7553 --radius 5 --sport cau-long
```

See `docs/geo-radius.md` for the SQL and the rationale.

## Quick start (PostgreSQL)

Requirements: **Node.js 22.12+**, Git, PostgreSQL with PostGIS/btree_gist. Use a separate database ending `_dev` for local development and `_test` for automated tests.

```bash
git clone https://github.com/coderuit3k/sportshub.git
cd sportshub
npm ci                      # exact lockfile install (Prisma is pinned to 6.19.3)
cp .env.example .env        # configure local PostgreSQL dev/test URLs
npx prisma generate
npx prisma db push
ALLOW_DESTRUCTIVE_SEED=true npm run db:seed # local _dev/_test database only
npm run dev                 # http://localhost:3000
```

Notes:

- `./node_modules/.bin/prisma --version` must print **6.19.3**. If it
  prints 7.x, your install drifted (usually a broken earlier install);
  delete `node_modules` and re-run `npm ci`. Do **not** edit the schema
  to satisfy Prisma 7.
- If npm reports *install scripts blocked* for `@prisma/engines`,
  `prisma`, `esbuild`, `@swc/core`, `sharp` or `@parcel/watcher`,
  approve them (`npm install-scripts approve @prisma/engines
  @prisma/client prisma esbuild @swc/core sharp @parcel/watcher`)
  and re-run the install — without the Prisma engine scripts the
  client cannot be generated and every later step fails.
- ⚠️ `npm run db:seed` **wipes and recreates** the database it points
  at. Never run it while `DATABASE_URL` points at production.
- Later runs need only `npm run dev`.

## Optional tiers

### AI assistant (Bedrock)

Add to `.env` (provider and model already default to Bedrock + Haiku 4.5):

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

The AWS account needs Bedrock model access for Claude Haiku 4.5 in
that region. Without credentials the `/assistant` page renders but the
first turn returns a typed configuration error — there is no fake
fallback model.

### Enable PostGIS radius search

Install PostgreSQL 16 with PostGIS 3 (Ubuntu: `postgresql-16-postgis-3`),
create a database/user, and set a **real** `DATABASE_URL` in `.env`
(the placeholder host in `.env.example` will not connect):

```bash
# .env
DATABASE_URL=[SECURITY_DATA]
```

```bash
npm run db:generate
npm run db:push
ALLOW_DESTRUCTIVE_SEED=true npm run db:seed
npm run db:postgis
npm run venues:near -- --lat 10.8503 --lng 106.7553 --radius 5
```

(The helper scripts read `.env` themselves; no shell export needed.
All runtime and test database paths use PostgreSQL.)

### Photo uploads (Cloudflare R2) & rate limiting (Upstash)

Set all five `R2_*` variables to enable owner photo uploads, and add a
bucket CORS policy allowing `PUT` from your app origin
(`http://localhost:3000` locally) — without CORS the browser upload
fails at preflight even with correct credentials. Set both `KV_*`
variables to switch rate limiting from the per-instance in-memory
fallback to shared Upstash counters. Details in the env table below.

## Dev accounts (LOCAL DEVELOPMENT ONLY — never reuse in production)

| Role | Email | Password |
|---|---|---|
| Player | player@sportshub.local | `Password123!` |
| Venue Owner | owner@sportshub.local | `Password123!` |
| Admin | admin@sportshub.local | `Password123!` |

> **Production (important):** the seeded accounts above ship with a PUBLIC
> password. Rotate or lock them from **Admin → Người dùng** immediately after
> the first production deploy (see `docs/security.md`, "Demo-account
> rotation"). The login page does not display these credentials.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL _dev locally; pooled Neon URL in production |
| `DATABASE_URL_UNPOOLED` | prod | Direct Neon connection used by build-time db push |
| `AUTH_SECRET` | yes | JWT signing secret |
| `NEXT_PUBLIC_APP_URL` | yes | Public base URL of the deployment |
| `AI_PROVIDER`, `AI_MODEL` | optional | Default `bedrock` + `anthropic.claude-haiku-4-5-20251001-v1:0`; `openai-compatible` switches provider |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | optional | Bedrock credentials; without them the assistant reports a typed config error |
| `AI_ASSISTANT_ENABLED` | optional | Kill switch for the assistant (`false` disables) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | optional | Upstash Redis; without both, rate limiting falls back to per-instance memory |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | optional | Cloudflare R2 photo storage; all five or uploads stay disabled (photos still display from the built-in photo pools) |

See `.env.example` for the full annotated list. Never commit real values.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` / `npm run start` | Dev server / production build / serve build |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest suite; TEST_DATABASE_URL required, isolated PostgreSQL schemas, no PG skips |
| `npm run test:e2e` | Playwright with isolated PostgreSQL schema and build cache; real catalog fixtures |
| `npm run db:generate` / `npm run db:push` | PostgreSQL Prisma client / schema push (dev only) |
| `npm run db:seed` | Destructive reseed: dev accounts + real catalog |
| `npm run db:postgis` | Enable PostGIS + report status (PostgreSQL only) |
| `npm run venues:near -- --lat … --lng … --radius … [--sport …]` | Radius search over venue coordinates |
| `npx tsx eval/ai/run-benchmark.ts` | Scripted AI benchmark, 50 cases → `eval/ai/report.md` |

## Deployment

Vercel project `sportshub`: CI tests PostgreSQL/PostGIS and browser journeys. CD
runs only for a successful CI push on the current `main` commit and waits for
`coderuit3k` to approve environment `vercel`. Manual CD dispatch checks credentials
only. Git auto-deploy is disabled; the build generates the PG client and builds
Next.js without schema push, catalog sync, seed or photo migration.
See `docs/deployment.md` for setup, release gates and rollback.

## Documentation

| Doc | Contents |
|---|---|
| `docs/architecture.md` | System design, image storage setup |
| `docs/database.md` | PostgreSQL schema, isolated test fixtures, booking constraint |
| `docs/api.md` | HTTP API surface |
| `docs/deployment.md` | Deploy & operations |
| `docs/security.md` | Auth, RBAC, demo-account rotation |
| `docs/ai-assistant.md` | Assistant design + decision policy |
| `docs/ai-tools.md` | The seven tools: contracts and envelopes |
| `docs/ai-evaluation.md` | Test layers, live battery, release gates |
| `docs/ai-demo-runbook.md` | Scripted demo walkthrough |
| `docs/geo-radius.md` | PostGIS radius search: design + SQL |

## Known limitations

- Payments and outbound email are simulated (see the banner above).
- AI assistant latency: simple turns answer in ~6–10 s, but a full
  search + compare turn takes ~35 s (several model rounds; the model
  sometimes needs one self-correction round on tool inputs).
- Imported-venue prices are platform reference prices and availability
  is the SportsHub demo schedule — labelled everywhere they appear.
- Some legacy Playwright specs still hardcode slugs from the retired
  fictional catalog and need updating.
