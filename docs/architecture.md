# Architecture

```
src/
  app/            # App Router pages + API route handlers
    (pages)       # /, /venues, /venues/[slug], /my-bookings, /community,
                  # /profile, /favorites, /notifications, /owner, /admin, /login, /register
    api/          # auth, bookings (+[id]/action), availability, favorites, sessions (+[id]/join),
                  # admin/venues/[id], profile
  components/     # Header, VenueCard, client-widgets (booking widget, action buttons, join, favorite)
  services/       # bookings.ts — availability, transactional booking creation, transitions
  lib/
    auth.ts       # bcryptjs + jose JWT session cookie, getCurrentUser, RBAC helpers
    db.ts         # shared Prisma client
    booking/logic.ts  # PURE logic: price, refund, overlap, transitions, capacity (unit-tested)
    time/tz.ts    # business-timezone helpers (Asia/Ho_Chi_Minh) — see "Timezone" below
    payments/     # provider abstraction — SimulatedPaymentProvider only
    notifications.ts  # in-app notifications with dedupeKey
  middleware.ts   # protects /my-bookings, /profile, /owner, /admin, /favorites, /notifications; role gates
prisma/           # schema.prisma (SQLite), schema.postgresql.prisma, seed.ts
tests/            # Vitest unit tests for pure logic
```

Principles: Server Components by default; business logic in the service layer, never only in components; all prices computed server-side from `PriceRule`; authorization checked server-side on every mutation (middleware is a first gate, route handlers re-check ownership/role).

## Timezone

The business timezone is **Asia/Ho_Chi_Minh**. All booking math is anchored to
it, regardless of the timezone of the machine the code runs on:

- Price rules are matched by the Saigon wall clock: weekday (weekend rule) and
  hour (peak/off-peak) of each slot are read via `src/lib/time/tz.ts`
  (Intl-based), never via process-local `Date.getDay()` / `getHours()`.
- `getAvailability(facilityId, dateISO)` takes a plain calendar date
  (`YYYY-MM-DD`) meaning that date in Saigon. Operating hours are looked up by
  that date's weekday, day boundaries are Saigon midnights, and slots are
  Saigon wall-clock times converted to UTC instants.
- The client never constructs instants from date strings: the booking widget
  receives slot instants from the server (initial render, or
  `GET /api/availability?facilityId=…&date=YYYY-MM-DD` for other dates) and
  displays the server-provided Saigon `HH:MM` label. User-typed wall times
  (e.g. the community session form's `datetime-local`) are anchored with
  `saigonDateTimeToInstant`, not `new Date(str)`.
- All user-facing date/time rendering passes `timeZone: "Asia/Ho_Chi_Minh"`
  explicitly (e.g. My Bookings, community, owner/admin lists).

Why: production (Vercel) runs with a UTC process timezone. Booking logic that
read process-local time stored a "Saturday 14:00" pick as 14:00Z
(= 21:00 Saigon) and priced it against the wrong wall clock. Regression
coverage: `tests/tz.test.ts`, the timezone block in
`tests/booking-logic.test.ts` (the unit suite is run under both `TZ=UTC` and
`TZ=Asia/Ho_Chi_Minh`), and `tests/e2e/timezone.spec.ts` (Saturday 14:00 →
weekend price, rendered back as 14:00–15:00 in My Bookings).
