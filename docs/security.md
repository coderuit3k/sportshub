# Security

## Auth choice (documented trade-off)
The master prompt suggests Auth.js. This build uses an equivalent established approach — **bcryptjs password hashing (cost 10) + `jose`-signed JWT (HS256) in an httpOnly, SameSite=Lax cookie (7 days)** — to avoid next-auth beta friction with Next 15. Passwords are never stored in plaintext; secrets never reach client code (`AUTH_SECRET` is server-only). Session verification happens in middleware (edge, jose) and is re-checked in route handlers via `getCurrentUser()`.

## Authorization
- RBAC roles: PLAYER / OWNER / ADMIN, stored on User, embedded in the JWT, **and** re-validated against the DB user record.
- Ownership checks on every sensitive mutation: booking cancel (owner of booking, venue owner, or admin), approve/reject (venue owner or admin), admin venue approval (ADMIN only). Hiding nav links is never the security mechanism.
- Client-supplied prices, roles, totals, and statuses are never trusted: price is recomputed from PriceRule, role comes from the DB/session, status transitions are validated against `VALID_TRANSITIONS`.

## Other
- Zod validation on all API inputs. Prisma parameterises queries (no raw SQL injection surface).
- Booking creation is idempotent (unique key) and transactional; notifications dedupe by key.
- Payments: simulated provider only; no card data is ever collected or stored.
- Private participant contact info is not exposed in community pages.

## Known limitations / production hardening
- No rate limiting yet on login/register (add e.g. Upstash/edge limiter before production).
- No email verification / password recovery flow (auth abstraction leaves room; document as Phase 2).
- SQLite dev has no DB-level exclusion constraint — see docs/database.md for the PostgreSQL gist constraint.
- Set a strong `AUTH_SECRET` and `secure` cookies (automatic in production mode) in deployment.
