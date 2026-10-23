# Deployment

## Local
See README quick start. SQLite file DB, `npm run dev` or `npm run build && npm run start`.

## Production (target)
1. Provision managed PostgreSQL; optionally `docker compose up -d db` for self-hosted parity.
2. Use `prisma/schema.postgresql.prisma` (docs/database.md migration path incl. the tstzrange exclusion constraint).
3. Env: `DATABASE_URL` (postgres), `AUTH_SECRET` (≥32 random chars), `NEXT_PUBLIC_APP_URL`.
4. `npx prisma migrate deploy` → `npm run build` → `npm run start` (or a Next.js hosting platform).
5. Do NOT seed production with dev accounts. Create the first admin via a one-off script and rotate credentials.
6. Configure a real payment provider (VietQR/MoMo) behind `src/lib/payments` before claiming payments work; until then UI must keep the SIMULATED label.

## Unverified in this environment
Production PostgreSQL deployment itself was not executed here (no Postgres/Docker on the VM); the SQLite build, seed, tests, typecheck and production `next build` are the verified gates — see docs/master-prompt.md checklist.

## Vercel production (verified flow, added 2026-10-23)

- Project `sportshub` is linked to this GitHub repo; production domain: https://sportshub-pi-five.vercel.app
- Database: Neon (`sportshub-db`, Singapore) connected through the Vercel integration, which injects `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_PRISMA_URL`, etc. (production + preview). No realtime add-on is used.
- `AUTH_SECRET` and `NEXT_PUBLIC_APP_URL` are set as project env vars (all targets).
- `vercel.json` overrides the build command so every production build:
  1. generates the Prisma client from `prisma/schema.postgresql.prisma`,
  2. runs `prisma db push` over the UNPOOLED connection,
  3. runs `prisma/deploy-db.ts` — ensures the `booking_no_overlap_active` tsrange exclusion constraint, and seeds ONLY if the database is empty,
  4. runs `next build`.
  All steps are idempotent, so redeploys are safe and never wipe data.
