# Database

## PostgreSQL only

`prisma/schema.prisma` is the PostgreSQL default for development, test and production.
`schema.postgresql.prisma` remains a legacy PG compatibility file; new commands use
the default schema. No data is copied from or written to SQLite.

Tests require `TEST_DATABASE_URL` pointing to a database ending `_test`. Each suite
creates a random schema, pushes the canonical schema, applies the booking exclusion
constraint, and drops only its own schema on cleanup. Missing configuration fails
instead of skipping. PostGIS/btree_gist extensions live in `public`.

Use a separate `_dev` database for development. `db:seed` deletes data and requires
`ALLOW_DESTRUCTIVE_SEED=true`; it refuses production and databases without a `_dev`
or `_test` suffix. Never point tests/seed at the existing production database.
Production builds no longer run DDL/catalog/seed operations. Review schema changes
with a backup/rollout/rollback plan separately from application deployment.

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

The same constraint is applied to automated test schemas. Concurrent insert tests verify overlap exclusion and cancellation releasing the time range.

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
- `priceSnapshot` / `policySnapshot` are JSON strings (the existing storage contract is preserved) — parsed at read time.

## Prisma7 driver migration

The generated client uses stable7.10.1 and `@prisma/adapter-pg`. Constructors are
centralized in `src/lib/prisma-client.ts`; CLI URLs and seed live in
`prisma.config.ts`. Prisma6 and Prisma7 models compare as an empty migration,
including canonical/legacy PG schema parity. No production DDL/data operation
is part of this change. Tests check raw/model isolation with reused IDs and URL
search_path overrides, booking exclusion constraints, capacity races and both TZs.
