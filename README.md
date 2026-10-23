# SportsHub — Vietnam Sports Discovery, Booking & Community Platform

Production-oriented MVP built from the SportsHub master prompt. Original product, fictional seed data.

> ⚠️ Payments are **SIMULATED only**. No real money moves. Every Payment record is labelled `SIMULATED`.

## Stack (with documented environment trade-offs)

- Next.js 15 (App Router) + React 19 + TypeScript strict + Tailwind CSS 3
- Prisma ORM. **Local dev: SQLite** (`DATABASE_URL="file:./dev.db"`) because this VM originally had no PostgreSQL/Docker.
  Production schema ships as `prisma/schema.postgresql.prisma` — **PostgreSQL path verified end-to-end on 2026-10-23 (PostgreSQL 16.15: db push, exclusion constraint, seed, app smoke test)**, see `docs/database.md`.
- Auth: bcryptjs + `jose` JWT in an httpOnly cookie (Auth.js-equivalent choice, see `docs/security.md`). RBAC: `PLAYER` / `OWNER` / `ADMIN`.
- Design tokens from the Stitch project: primary `#0F5132`, secondary `#10B981`, accent `#F59E0B`, neutral `#0F172A`; fonts Plus Jakarta Sans + Inter.
- UI language: Vietnamese. Currency VND, display timezone Asia/Ho_Chi_Minh.

## Quick start

```bash
npm install
cp .env.example .env        # local default already works with SQLite
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev                 # http://localhost:3000
```

## Dev accounts (LOCAL DEVELOPMENT ONLY — never reuse in production)

| Role | Email | Password |
|---|---|---|
| Player | player@sportshub.local | `Password123!` |
| Venue Owner | owner@sportshub.local | `Password123!` |
| Admin | admin@sportshub.local | `Password123!` |

> **Production (quan trọng):** the seeded demo accounts above ship with a PUBLIC
> password. Immediately after the first production deploy, sign in as admin and
> rotate or lock every demo account from **Admin → Người dùng** ("Đặt mật khẩu
> mới" / "Khoá tài khoản" — see docs/security.md, "Demo-account rotation").
> The login page no longer displays these credentials (Phase 3).

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest unit tests (pure booking logic, admin user-management policy/guards, rate limiter, change-password validation)
- `npm run test:e2e` — Playwright E2E (booking flow, change password, community join/leave, RBAC guards).
  Requires the local DB seeded (`npm run db:seed`) and Chromium installed
  (`npx playwright install chromium`). Playwright builds + starts the app itself
  on port 3100 via the config's `webServer`.
- `npm run db:seed`, `npm run db:push`, `npm run db:generate`
- CI (`.github/workflows/ci.yml`) runs install → Prisma generate/push/seed → typecheck → unit → E2E.
  Note: the workflow file exists in the local working tree but is **not on GitHub yet** (the GitHub App
  lacks the Workflows permission — the repo owner uploads this one file manually), so hosted CI runs
  start only after that upload.

## Features implemented

Home + venue explore (combinable DB filters, URL params) + venue detail with live availability slots,
3-step booking widget, server-side pricing, transactional double-booking prevention, idempotent booking
creation, cancellation refunds from the stored policy snapshot, My Bookings tabs, favorites,
community sessions (create/join/leave, capacity + duplicate prevention), user profile/preferences,
owner dashboard (stats, approve/reject), admin dashboard (venue approval queue, users, audit log),
in-app notifications, sitemap/robots.

Completion round additions: **rate limiting** on login (10 failed / 10 min per IP+email), register
(5/hour per IP) and booking creation (30 / 10 min per user) — in-memory sliding window, per-instance
best-effort on serverless, 429 + `Retry-After` (see `docs/security.md`); **self-service password change**
in /profile (current password verified, min-10 policy, audit-logged); **keyless maps** on venue pages —
"Chỉ đường" Google Maps directions link for every venue + OpenStreetMap embed when the venue has
coordinates (seed venues carry demo coordinates); **`GET /api/health`** readiness probe
(`{ status: "ok", db: "ok" }`, 503 when the DB is unreachable); branded 404 / error / loading pages.

Docs: `docs/architecture.md`, `docs/database.md`, `docs/api.md`, `docs/security.md`, `docs/deployment.md`, `docs/master-prompt.md`.
