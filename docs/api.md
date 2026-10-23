# API (Route Handlers, JSON)

All mutations require the `sportshub_session` httpOnly cookie unless noted. Errors: `{ error: string, code?: string }`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /api/auth/register | public | Zod-validated; role PLAYER or OWNER only (ADMIN cannot self-register) |
| POST | /api/auth/login | public | bcrypt compare; sets session cookie |
| POST | /api/auth/logout | session | clears cookie |
| POST | /api/bookings | session | Body: facilityId, startAt, endAt, idempotencyKey. Server computes price. Same key → returns existing booking (200). 409 SLOT_TAKEN / SLOT_BLOCKED |
| POST | /api/bookings/[id]/action | session + ownership/role | action: cancel / approve / reject / complete. Cancel computes refund from stored policy snapshot |
| POST | /api/favorites | session | toggles favorite |
| POST | /api/sessions | session | creates session; organizer auto-joined |
| POST | /api/sessions/[id]/join | session | action join/leave; capacity + duplicate checks; full → 409 |
| POST | /api/admin/venues/[id] | ADMIN | action approve/reject; writes AuditLog + notification |
| PATCH | /api/profile | session | name, preferred district/time, preferred sports |

Pages are server-rendered from Prisma directly (no public read API needed for MVP).
