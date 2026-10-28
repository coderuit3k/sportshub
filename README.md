# SportsHub — Vietnam Sports Discovery, Booking & Community Platform

Discover, book and play: real sports venues across Ho Chi Minh City with live
availability, server-side pricing, community match sessions ("Play Together"),
and owner/admin consoles.

**Live:** https://sportshub-pi-five.vercel.app

> ⚠️ Payments are **SIMULATED only** — no real money moves, and every Payment
> record is labelled `SIMULATED`. Outbound email is likewise simulated
> (in-app notifications are real). A real payment/email provider is the main
> remaining step before a commercial launch, together with a paid Vercel
> plan and a custom domain.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript strict + Tailwind CSS 3
- Prisma ORM — **SQLite for local dev**, **PostgreSQL in production**
  (`prisma/schema.postgresql.prisma`, hosted on Neon, Singapore region)
- Auth: bcryptjs + `jose` JWT in an httpOnly cookie. RBAC: `PLAYER` / `OWNER` / `ADMIN`
- Maps: Leaflet over OpenStreetMap raster tiles (no API key, no WebGL)
- Venue photo storage: Cloudflare R2 (S3-compatible, presigned uploads)
- Rate limiting: Upstash Redis (Vercel KV) with a per-instance in-memory fallback
- i18n: next-intl — Vietnamese (default) + English, persisted by cookie, URLs unchanged
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
  build** (via `prisma/deploy-db.ts`): it retires any non-Google venue
  (live bookings block the purge and fail the build loudly instead of losing
  data) and re-syncs venues + reviews, so a data-only edit redeploys cleanly.
  The same step ends `prisma/seed.ts`, so a fresh local DB converges to the
  identical catalog.

Rating filters use the *effective* rating (`googleRating ?? in-app ratingAvg`)
consistently across list, map and featured ranking.

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

**AI assistant** (`/assistant`)
- Vietnamese conversational agent over seven typed, read-only tools
  (venue search, profiles, verbatim review evidence, review stats,
  live availability + quotes, same-condition comparison, booking
  handoff) with explicit conversation state, hard tool/time budgets,
  and answers validated + hydrated server-side from tool results
- Field-level provenance everywhere: Google aggregates stay separate
  from in-app ratings, prices are labelled platform reference prices,
  the schedule is labelled as the SportsHub demo schedule
- The assistant never creates a booking — it prepares a handoff card
  into the existing booking widget; runs on **Amazon Bedrock**
  (Claude Haiku 4.5, `AI_PROVIDER=bedrock` + AWS credentials; the bare
  model ID resolves to the region's inference profile automatically),
  with a kill switch (`AI_ASSISTANT_ENABLED=false`)
- Docs: `docs/ai-assistant.md`, `docs/ai-tools.md`,
  `docs/ai-evaluation.md`, `docs/ai-demo-runbook.md`

**Platform**
- Rate limiting on auth, booking and API writes (429 + `Retry-After`,
  `{ code: "RATE_LIMITED" }` contract)
- Cached public reads (`unstable_cache` DTOs in `src/lib/public-data.ts`)
- `GET /api/health` readiness probe (503 when the DB is unreachable)
- Branded 404 / error / loading pages, sitemap + robots
- **PostGIS radius search** on PostgreSQL: with the `postgis`
  extension enabled, queries like "venues within 5 km" run in SQL
  over venue coordinates — `npm run db:postgis` (setup) and
  `npm run venues:near -- --lat 10.8503 --lng 106.7553 --radius 5`
  (run it); see `docs/geo-radius.md`

## Quick start (local)

```bash
npm install
cp .env.example .env        # local default already works with SQLite
npx prisma generate
npx prisma db push
npm run db:seed             # seeds accounts + the same 119-venue real catalog
npm run dev                 # http://localhost:3000
```

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
| `DATABASE_URL` | yes | SQLite file locally; pooled Neon URL in production |
| `DATABASE_URL_UNPOOLED` | prod | Direct Neon connection used by build-time db push |
| `AUTH_SECRET` | yes | JWT signing secret |
| `NEXT_PUBLIC_APP_URL` | yes | Public base URL of the deployment |
| `AI_PROVIDER`, `AI_MODEL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | optional | AI assistant on Amazon Bedrock (Claude Haiku 4.5); without AWS credentials the assistant reports a typed config error |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | optional | Upstash Redis; without both, rate limiting falls back to per-instance memory |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | optional | Cloudflare R2 photo storage; all five or uploads stay disabled (photos still display from the built-in photo pools) |

See `.env.example` for details. Never commit real values.

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run typecheck` — `tsc --noEmit`
- `n
...[truncated 2315 chars]