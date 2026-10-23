-- SportsHub — hard double-booking guarantee for PostgreSQL.
-- Apply AFTER `prisma db push` / `prisma migrate deploy` has created the
-- "Booking" table (Prisma cannot express exclusion constraints natively).
--
--   psql "$DATABASE_URL" -f prisma/postgresql/booking_no_overlap.sql
--
-- Requires the btree_gist extension (package postgresql-contrib).
-- NOTE on range type: Prisma maps DateTime to TIMESTAMP(3) (without time
-- zone), so the immutable range constructor is tsrange — tstzrange() on
-- timestamp columns depends on the session TimeZone and PostgreSQL rejects
-- it in index expressions ("functions in index expression must be marked
-- IMMUTABLE", verified 2026-10-23). If the columns are ever migrated to
-- TIMESTAMPTZ, switch tsrange -> tstzrange.
-- The constraint is partial: only active bookings (PENDING, CONFIRMED) are
-- in scope, so CANCELLED / REJECTED / EXPIRED / COMPLETED rows never block
-- a time range. When a booking leaves an active status, PostgreSQL drops it
-- from the constraint's scope automatically.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT booking_no_overlap_active
  EXCLUDE USING gist (
    "facilityId" WITH =,
    tsrange("startAt", "endAt") WITH &&
  )
  WHERE ("status" IN ('PENDING', 'CONFIRMED'));
