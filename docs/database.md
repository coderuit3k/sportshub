# Database

## Local vs production
- Local/dev: SQLite via `prisma/schema.prisma` (`DATABASE_URL="file:./dev.db"`). Chosen because the dev VM has no PostgreSQL and no Docker.
- Production: PostgreSQL via `prisma/schema.postgresql.prisma` (identical models; roles/statuses are portable `String` columns validated in the service layer). `docker-compose.yml` provides Postgres 16 for parity testing.

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
    tstzrange("startAt", "endAt") WITH &&
  )
  WHERE ("status" IN ('PENDING', 'CONFIRMED'));
```

How cancelled/expired bookings are excluded: the constraint is **partial** — the `WHERE` clause restricts it to active bookings only (`PENDING`, `CONFIRMED`). Rows in `CANCELLED`, `REJECTED`, `EXPIRED`, or `COMPLETED` are not indexed by the constraint, so their time ranges never block new bookings. When a booking transitions out of an active status, PostgreSQL automatically removes it from the partial constraint's scope.

On SQLite this gist constraint does not exist; the transactional overlap check in `src/services/bookings.ts` is the enforcement mechanism there (serializable-enough for the single-process dev workload; documented limitation).

## Key constraints & indexes
- `Favorite @@unique(userId, venueId)`, `SessionParticipant @@unique(sessionId, userId)`, `Booking.idempotencyKey @unique`, `IdempotencyKey.key @unique`, `Venue.slug @unique`, `Booking.reference @unique`.
- Indexes: Venue(city, district), Venue(status), Booking(userId, startAt), Booking(facilityId, status), SportsSession(sportId, venueId, startAt), Review(venueId), Notification(userId, isRead).
- Timestamps stored as given by the server (UTC in production); displayed converted to Asia/Ho_Chi_Minh.
- `priceSnapshot` / `policySnapshot` are JSON strings (SQLite has no Prisma Json type) — parsed at read time.
