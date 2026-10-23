# Master Prompt Summary & Definition of Done

Source: user's MASTER PROMPT "BUILD SPORTSHUB — ALL-IN-ONE SPORTS DISCOVERY, BOOKING & COMMUNITY PLATFORM" (also the prompt behind Stitch project 13380155060834724414, "SportsHub Vietnam Platform").

Scope in one line: multi-role (Player / Venue Owner / Admin + Community) sports venue discovery, booking and community platform for Vietnam (HCMC first), Vietnamese UI, VND, Asia/Ho_Chi_Minh, Next.js + Prisma + PostgreSQL target, working full-stack app — not a static prototype.

Environment decisions (already made, documented as trade-offs):
- SQLite for the locally runnable app + portable schema + shipped PostgreSQL schema & exclusion-constraint SQL (no Postgres/Docker on the VM).
- bcryptjs + jose JWT cookie auth instead of next-auth beta (docs/security.md).
- Design tokens matched to Stitch: #0F5132 / #10B981 / #F59E0B / #0F172A, Plus Jakarta Sans + Inter.
- Payments: simulated provider only, clearly labelled.

## Definition of Done checklist (honest status at delivery — updated after verification runs)
- [x] Application starts successfully (verified via build + local start/curl where feasible)
- [x] Database schema applied + seed runs (SQLite `db push` + seed)
- [x] Authentication and role authorization work (middleware + server checks)
- [x] Users can discover actual database-backed venues (home, /venues filters)
- [x] Availability computed from operating hours − blocked − active bookings
- [x] Booking creation prevents conflicting reservations (transactional overlap check; PG exclusion SQL documented)
- [x] Booking history and cancellation work per stored policy snapshot (refund tiers 100% / −30% fee / none)
- [x] Venue owners can manage/see their venues and approve/reject bookings (/owner)
- [x] Community sessions and participation work (capacity + duplicate prevention)
- [x] Administrators can review and approve venues (/admin queue + audit log)
- [x] Unit tests for critical pure logic (price/refund/overlap/transitions/capacity)
- [ ] Real payment, email, maps providers — NOT integrated (simulated/labelled boundaries only)
- [ ] Production PostgreSQL deployment — NOT executed in this environment
- [ ] Playwright E2E suite — not included; critical flows verified manually via curl where feasible
