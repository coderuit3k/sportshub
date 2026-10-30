# API (Route Handlers, JSON)

All mutations require the `sportshub_session` httpOnly cookie unless noted. Errors: `{ error: string, code?: string }`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /api/auth/register | public | Zod-validated; role PLAYER or OWNER only (ADMIN cannot self-register). Rate limited: 5/hour per IP → 429 |
| POST | /api/auth/login | public | bcrypt compare; sets session cookie. Rate limited: 10 FAILED attempts / 10 min per IP+email → 429 + Retry-After |
| GET | /api/health | public | `{ status: "ok", db: "ok" }` via a real `SELECT 1` probe; 503 `{ status: "error", db: "unreachable" }` when the DB is down. No sensitive info |
| POST | /api/auth/logout | session | clears cookie |
| GET | /api/availability | public | facilityId + Saigon calendar date. Returns slots starting on that date, including early slots from the prior day's overnight schedule. Approved venues only; missing price rules return `price: null`, `available: false`. |
| POST | /api/bookings | session | Body: facilityId, startAt, endAt, idempotencyKey. Server computes price and checks operating hours. Same user + key + request → existing booking (200); reused key with different user/request → 409 IDEMPOTENCY_CONFLICT. 409 SLOT_TAKEN / SLOT_BLOCKED. Rate limited: 30 / 10 min per user → 429 |
| POST | /api/bookings/[id]/action | session + ownership/role | action: cancel / approve / reject / complete. Cancel computes refund from stored policy snapshot. If another action changes status first, returns 409 `BOOKING_STATE_CHANGED`; client should reload before retrying. |
| POST | /api/favorites | session | toggles favorite |
| POST | /api/sessions | session | Creates session and organizer participation atomically; invalidates session cache. |
| POST | /api/sessions/[id]/join | session | action join/leave; capacity and status checked inside a serializable transaction. Duplicate, full, closed or concurrent conflict → 409. Session cache invalidated after success. |
| POST | /api/admin/venues/[id] | ADMIN | action approve/reject; writes AuditLog + notification |
| PATCH | /api/profile | session | name, preferred district/time, preferred sports |
| POST | /api/profile/change-password | session | Body: currentPassword, newPassword, confirmPassword. Verifies current password (wrong → 400); new password min 10 chars, must differ from current and match confirmation. Changes ONLY the session user's own password; audit-logged; current session stays valid |

Pages are server-rendered from Prisma directly (no public read API needed for MVP).
