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

## Rate limiting (completion round)
`src/lib/rate-limit.ts` — a small dependency-free sliding-window limiter. The core (`SlidingWindowLimiter`) is pure and clock-injectable (unit-tested); route handlers use shared module-level instances:

| Endpoint | Limit | Key | Counts |
|---|---|---|---|
| POST /api/auth/login | 10 / 10 min | client IP + email | FAILED attempts only; counter resets on success, so legitimate users are never locked out by their own logins |
| POST /api/auth/register | 5 / 1 hour | client IP | every attempt |
| POST /api/bookings | 30 / 10 min | user id | every creation attempt |

Client IP = first hop of `x-forwarded-for` (set by Vercel/proxies), falling back to `x-real-ip`. Over-limit requests get **HTTP 429** `{ error, code: "RATE_LIMITED" }` (Vietnamese message) plus a `Retry-After` header (seconds until the oldest hit leaves the window).

**Honest limitation:** counters live in a per-instance in-memory Map. On serverless (Vercel) each warm instance counts separately, so the effective global limit is roughly `limit × concurrent instances`. This is a best-effort brake against credential stuffing and signup spam — NOT a hard global quota. The limiter's check/record/reset surface is deliberately shaped so the storage can be swapped for a shared store (Upstash Redis / Vercel KV) without touching route handlers when a hard quota is needed.

## Self-service password change (completion round)
`POST /api/profile/change-password` (session required): the user proves knowledge of the current password (bcrypt compare; wrong → 400), the new password must satisfy the SAME policy admins use for resets (`validateNewPassword`, min 10 chars), differ from the current one, and match its confirmation. Only the session user's own password can ever be changed (target id comes from the session). The change is audit-logged (`USER_PASSWORD_CHANGED`). **Session choice:** the current session is kept after a change — sessions are stateless 7-day JWTs with no server-side revocation list, so other sessions cannot be selectively revoked without new infrastructure; they expire naturally.

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
- Rate limiting is per-instance in-memory (see "Rate limiting" above) — swap the store for Upstash Redis / Vercel KV if a hard global quota is ever required.
- No email verification / password recovery flow (auth abstraction leaves room; document as future work).
- Sessions cannot be revoked server-side (stateless JWT); a stolen token stays valid until expiry (7 days) unless the account is locked by an admin.
- SQLite dev has no DB-level exclusion constraint — see docs/database.md for the PostgreSQL gist constraint.
- Set a strong `AUTH_SECRET` and `secure` cookies (automatic in production mode) in deployment.
