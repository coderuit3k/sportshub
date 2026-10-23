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
- `npm test` — Vitest unit tests (pure booking logic + admin user-management policy/guards)
- `npm run test:e2e` — Playwright E2E (booking flow, community join/leave, RBAC guards).
  Requires the local DB seeded (`npm run db:seed`) and Chromium installed
  (`npx playwright install chromium`). Playwright builds + starts the app itself
  on port 3100 via the config's `webServer`.
- `npm run db:seed`, `npm run db:push`, `npm run db:generate`
- CI (`.github/workflows/ci.yml`) runs install → Prisma generate/push/seed → typecheck → unit → E2E on every push/PR.

## Features implemented

Home + venue explore (combinable DB filters, URL params) + venue detail with live availability slots,
3-step booking widget, server-side pricing, transactional double-booking prevention, idempotent booking
creation, cancellation refunds from the stored policy snapshot, My Bookings tabs, favorites,
community sessions (create/join/leave, capacity + duplicate prevention), user profile/preferences,
owner dashboard (stats, approve/reject), admin dashboard (venue approval queue, users, audit log),
in-app notifications, sitemap/robots.

Docs: `docs/architecture.md`, `docs/database.md`, `docs/api.md`, `docs/security.md`, `docs/deployment.md`, `docs/master-prompt.md`.
