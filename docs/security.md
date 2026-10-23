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

## Demo-account rotation (production procedure, Phase 3)
The seed creates player/owner/admin demo accounts with the public password `Password123!` (local-dev convenience, documented in README). On production this is a known, must-fix exposure:

1. Right after the first production deploy, sign in as the seeded admin.
2. Go to **Admin → Người dùng**. For every demo account either:
   - **Đặt mật khẩu mới** — sets a new password (min 10 chars, bcrypt-hashed server-side via `POST /api/admin/users/[id]` with `action: "set-password"`), or
   - **Khoá tài khoản** — replaces the hash with a hash of an unknown random value (`action: "lock"`), so no known password can sign in; unlock later by setting a new password.
3. An admin cannot lock their own account (self-lock guard, `canLockAccount` in `src/lib/admin/user-admin.ts`). Rotate the admin's own password last, from its own row, then sign in again with the new password.
4. Every set-password/lock action writes an `AuditLog` entry (`USER_PASSWORD_RESET` / `USER_LOCKED`, actor + target email) visible in the admin Audit Log section.
5. The `/login` page does not display demo credentials anymore (removed in Phase 3); credentials live only in local-dev docs (README/seed).

## Known limitations / production hardening
- No rate limiting yet on login/register (add e.g. Upstash/edge limiter before production).
- No email verification / password recovery flow (auth abstraction leaves room; document as Phase 2).
- SQLite dev has no DB-level exclusion constraint — see docs/database.md for the PostgreSQL gist constraint.
- Set a strong `AUTH_SECRET` and `secure` cookies (automatic in production mode) in deployment.
