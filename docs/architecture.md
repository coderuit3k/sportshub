# Architecture

```
src/
  app/            # App Router pages + API route handlers
    (pages)       # /, /venues, /venues/[slug], /my-bookings, /community,
                  # /profile, /favorites, /notifications, /owner, /admin, /login, /register
    api/          # auth, bookings (+[id]/action), favorites, sessions (+[id]/join),
                  # admin/venues/[id], profile
  components/     # Header, VenueCard, client-widgets (booking widget, action buttons, join, favorite)
  services/       # bookings.ts — availability, transactional booking creation, transitions
  lib/
    auth.ts       # bcryptjs + jose JWT session cookie, getCurrentUser, RBAC helpers
    db.ts         # shared Prisma client
    booking/logic.ts  # PURE logic: price, refund, overlap, transitions, capacity (unit-tested)
    payments/     # provider abstraction — SimulatedPaymentProvider only
    notifications.ts  # in-app notifications with dedupeKey
  middleware.ts   # protects /my-bookings, /profile, /owner, /admin, /favorites, /notifications; role gates
prisma/           # schema.prisma (SQLite), schema.postgresql.prisma, seed.ts
tests/            # Vitest unit tests for pure logic
```

Principles: Server Components by default; business logic in the service layer, never only in components; all prices computed server-side from `PriceRule`; authorization checked server-side on every mutation (middleware is a first gate, route handlers re-check ownership/role).
