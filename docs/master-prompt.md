# Master Prompt Summary & Definition of Done

Source: user's MASTER PROMPT "BUILD SPORTSHUB — ALL-IN-ONE SPORTS DISCOVERY, BOOKING & COMMUNITY PLATFORM" (also the prompt behind Stitch project 13380155060834724414, "SportsHub Vietnam Platform").

Scope in one line: multi-role (Player / Venue Owner / Admin + Community) sports venue discovery, booking and community platform for Vietnam (HCMC first), Vietnamese UI, VND, Asia/Ho_Chi_Minh, Next.js + Prisma + PostgreSQL target, working full-stack app — not a static prototype.

Environment decisions (already made, documented as trade-offs):
- SQLite for the locally runnable app + portable schema + shipped PostgreSQL schema & exclusion-constraint SQL (no Postgres/Docker on the VM at first build). **Update 2026-10-23:** PostgreSQL 16.15 was installed on the VM and the PG path was verified end-to-end (db push, exclusion constraint enforced at SQL level, seed, app smoke test) — see `docs/database.md`.
- bcryptjs + jose JWT cookie auth instead of next-auth beta (docs/security.md).
- Design tokens matched to Stitch: #0F5132 / #10B981 / #F59E0B / #0F172A, Plus Jakarta Sans + Inter.
- Payments: simulated provider only, clearly labelled.

## Definition of Done checklist (honest status — updated after the 2026-10-23 completion round)
- [x] Application starts successfully (verified via build + local start/curl where feasible)
- [x] Database schema applied + seed runs (SQLite `db push` + seed; seed venues now carry demo lat/lng)
- [x] Authentication and role authorization work (middleware + server checks)
- [x] Users can discover actual database-backed venues (home, /venues filters)
- [x] Availability computed from operating hours − blocked − active bookings
- [x] Booking creation prevents conflicting reservations (transactional overlap check; PG exclusion constraint applied and proven at SQL level 2026-10-23)
- [x] Booking history and cancellation work per stored policy snapshot (refund tiers 100% / −30% fee / none)
- [x] Venue owners can manage/see their venues and approve/reject bookings (/owner)
- [x] Community sessions and participation work (capacity + duplicate prevention)
- [x] Administrators can review and approve venues (/admin queue + audit log) and manage users (set password / lock, Phase 3)
- [x] Self-service password change in /profile (current-password verified, shared min-10 policy, audit-logged) — completion round
- [x] Rate limiting on login / register / booking creation (in-memory sliding window, per-instance best-effort on serverless — see docs/security.md) — completion round
- [x] Health endpoint `GET /api/health` (real DB probe, 503 when DB unreachable) — completion round
- [x] Branded 404 (`app/not-found.tsx`), error boundary (`app/error.tsx`), loading skeleton (`app/loading.tsx`) — completion round
- [x] Keyless maps: "Chỉ đường" Google Maps directions deep-link on every venue + OpenStreetMap embed when the venue has coordinates — no API key, no maps provider account. (A paid/full maps provider integration is still NOT done.)
- [x] Unit tests for critical pure logic (price/refund/overlap/transitions/capacity + rate limiter + password-change/admin policy) — 34 tests
- [x] PostgreSQL verification — DONE 2026-10-23 on PostgreSQL 16.15 (local VM): db push (23 tables), exclusion constraint, seed, app smoke test all passed; evidence in `docs/database.md`
- [x] Hosted production PostgreSQL deployment — DONE 2026-10-23: live on Vercel + Neon (`sportshub-db`, Singapore) at https://sportshub-pi-five.vercel.app (build runs generate → db push → constraint + seed-if-empty; see docs/deployment.md)
- [x] Playwright E2E suite — DONE (Phase 3 + completion round): 5 specs (booking flow, change password, community join/leave, RBAC guards ×2), all passing locally
- [ ] Real payment provider — NOT integrated (simulated/labelled boundary only)
- [ ] Real email provider — NOT integrated (in-app notifications only; no email verification / password recovery flow)
- [ ] Hosted CI workflow — `.github/workflows/ci.yml` exists in the local working tree and runs the full pipeline, but it is NOT on GitHub yet: the GitHub App lacks the Workflows permission, so the repo owner uploads this one file manually. Until then there are no hosted CI runs.
