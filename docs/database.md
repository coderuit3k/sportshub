# Database

## Local vs production
- Local/dev: SQLite via `prisma/schema.prisma` (`DATABASE_URL="file:./dev.db"`). Chosen because the dev VM has no PostgreSQL and no Docker.
- Production: PostgreSQL via `prisma/schema.postgresql.prisma` (identical models; roles/statuses are portable `String` columns validated in the service layer). `docker-compose.yml` provides Postgres 16 for parity testing.
- **PostgreSQL path VERIFIED end-to-end on 2026-10-23** (local VM install, PostgreSQL 16.15): `prisma db push` created all 23 tables, the exclusion constraint below was applied, seed ran (7 venues, 3 users, 6 sports, 14 facilities, 3 sessions), and the app itself passed a smoke test against PG (see "Verification evidence"). A hosted production deployment is still a separate step.

## Migration path to PostgreSQL
1. `cp prisma/schema.postgresql.prisma prisma/schema.prisma` (or keep separate and run `prisma migrate --schema prisma/schema.postgresql.prisma`).
2. Set `DATABASE_URL=postgresql://...`.
3. `npx prisma migrate deploy` (generate the initial migration from the postgres schema first: `npx prisma migrate dev --name init`).
4. Apply the exclusion-constraint SQL below as a raw migration (Prisma cannot express it natively).
5. Run `npm run db:seed` only in non-production environments.

## Double-booking prevention — production (PostgreSQL)
Application layer already: overlap check inside a Prisma `$transaction`, active statuses = `PENDING, CONFIRMED`, plus a unique `idempotencyKey`.
For a hard database guarantee on PostgreSQL, add a range exclusion constraint:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT booking_no_overlap_active
  EXCLUDE USING gist (
    "facilityId" WITH =,
    tsrange("startAt", "endAt") WITH &&
  )
  WHERE ("status" IN ('PENDING', 'CONFIRMED'));
```

Range-type note (learned by actually applying it, 2026-10-23): Prisma maps `DateTime` to `TIMESTAMP(3)` (without time zone), so the range constructor must be `tsrange` — `tstzrange("startAt","endAt")` depends on the session TimeZone and PostgreSQL rejects it with `ERROR: functions in index expression must be marked IMMUTABLE`. If the columns are ever migrated to `TIMESTAMPTZ`, switch back to `tstzrange`. Ready-to-run file: `prisma/postgresql/booking_no_overlap.sql` (`psql "$DATABASE_URL" -f prisma/postgresql/booking_no_overlap.sql`, needs `postgresql-contrib` for `btree_gist`).

How cancelled/expired bookings are excluded: the constraint is **partial** — the `WHERE` clause restricts it to active bookings only (`PENDING`, `CONFIRMED`). Rows in `CANCELLED`, `REJECTED`, `EXPIRED`, or `COMPLETED` are not indexed by the constraint, so their time ranges never block new bookings. When a booking transitions out of an active status, PostgreSQL automatically removes it from the partial constraint's scope.

On SQLite this gist constraint does not exist; the transactional overlap check in `src/services/bookings.ts` is the enforcement mechanism there (serializable-enough for the single-process dev workload; documented limitation).

## Verification evidence — PostgreSQL run (2026-10-23, PostgreSQL 16.15)
- Install: `apt-get install postgresql postgresql-contrib` → `psql (PostgreSQL) 16.15`; dev-only role/db `sportshub` on the local VM.
- `npx prisma generate --schema prisma/schema.postgresql.prisma` + `DATABASE_URL=postgresql://… npx prisma db push --schema prisma/schema.postgresql.prisma` → all 23 tables created.
- Constraint applied from `prisma/postgresql/booking_no_overlap.sql` (after the `tsrange` fix above).
- Constraint proof at SQL level with direct inserts on a real facility: (a) active `CONFIRMED` 10:00–11:00 → inserted; (b) overlapping `CONFIRMED` 10:30–11:30 → rejected with `ERROR: conflicting key value violates exclusion constraint "booking_no_overlap_active"`; (c) overlapping `CANCELLED` → inserted (partial `WHERE` works). Test rows deleted after.
- Seed against PG: 7 venues, 3 users, 6 sports, 14 facilities, 3 community sessions.
- App smoke against PG (`DATABASE_URL=postgresql://… npm run build` + `start` on :3100): `GET /` → 200; login as player; Sunday booking → `201 CONFIRMED`, `totalPrice 160000` with `ruleType WEEKEND` computed server-side; overlapping booking with a different idempotency key → `409 SLOT_TAKEN`. Smoke rows cleaned up; local SQLite dev state re-seeded afterwards (unit tests 14/14, typecheck clean).

## Key constraints & indexes
- `Favorite @@unique(userId, venueId)`, `SessionParticipant @@unique(sessionId, userId)`, `Booking.idempotencyKey @unique`, `IdempotencyKey.key @unique`, `Venue.slug @unique`, `Booking.reference @unique`.
- Indexes: Venue(city, district), Venue(status), Booking(userId, startAt), Booking(facilityId, status), SportsSession(sportId, venueId, startAt), Review(venueId), Notification(userId, isRead).
- Timestamps stored as given by the server (UTC in production); displayed converted to Asia/Ho_Chi_Minh.
- `priceSnapshot` / `policySnapshot` are JSON strings (SQLite has no Prisma Json type) — parsed at read time.
