# Deployment

## Local and CI

Use Node.js26.13.0/npm12.2.1, PostgreSQL with PostGIS/btree_gist; Prisma CLI/client/adapter
are pinned to stable7.10.1. CI/build/runtime align to26.x; dependency install scripts
are explicitly approved by package/version. TypeScript7 CLI and the API6 compatibility
package are checked separately. Fonts are local assets, not build-time Google requests.
The default schema is PostgreSQL. Development uses a separate `_dev` DB;
TEST_DATABASE_URL and E2E_DATABASE_URL must point to `_test` databases.
Never use existing production data for tests, seed or schema-push verification.

`npm test` creates/drops a random PG schema per integration suite and applies
booking exclusion constraints. Missing configuration fails instead of skipping.
`npm run test:e2e` creates a fresh schema, seeds the real catalog plus a browser-only
community session, builds into `.next-e2e`, runs Chromium on local port 3100, then
removes its schema/build cache. It does not reuse another server.

CI uses a disposable PostGIS service: exact lockfile install, typecheck, both
business timezone suites, scripted eval and E2E. Paid models are not invoked.
Failure artifacts contain synthetic data and expire after seven days.

## Vercel approval gate

GitHub environment `vercel` requires reviewer `coderuit3k`, only accepts branch
`main`, and disables admin bypass. Self-review is allowed so the designated owner
can approve a workflow they triggered. The agent never approves deployment jobs.

Store VERCEL_TOKEN and VERCEL_PROJECT_ID in environment secrets. VERCEL_ORG_ID is
optional when a team scope is required. The read-only project lookup checks the
exact ID/name `sportshub`, discovers accountId and writes local link metadata.
It does not create a project or change Vercel environment variables.

Manual `Vercel CD` dispatch only checks credentials, behind the owner gate.
A successful CI push on main can build/deploy, also behind that gate. PR runs,
failed CI and stale releases cannot deploy. The approved SHA must equal current
main before build and again before deploy.

Git auto-deploy is disabled. Pinned Vercel CLI 65.8.0 pulls production configuration,
builds and deploys prebuilt output. The build generates the PG client and runs
Next.js; it performs no db push, seed, catalog sync or photo migration.

Prisma7 uses the JS PostgreSQL adapter. The generated TypeScript client lives in
`src/generated/prisma`; `prisma.config.ts` owns CLI datasource/seed settings.
The client factory preserves schema/search_path for both model and raw queries,
bounds pool/connect behavior and does not disable TLS verification. Generated
moduleFormat=cjs preserves current scripts without a package-wide ESM change.

The prior Prisma6 RHEL binary problem is obsolete with the new client. E2E now
checks actual health and discovery queries through the compiled driver adapter.
The legacy CD workflow is disabled during the approved upgrade; its replacement
will use standalone output, staged runtime checks and gated promotion as specified
in `docs/superpowers/specs/2026-10-31-cicd-plan-apply-design.md`.

## Rollout and rollback

Test the integrated candidate first. Merge the Git auto-deploy-disable change
before the existing reviewed PRs, PostgreSQL changes, E2E setup and CI/CD.
Retarget stacked PRs as dependencies reach main; require green final CI and owner
approval before production CD. Existing production data is retained.

The prior PostgreSQL schema and the canonical schema have identical models:
Prisma reports an empty migration. Future DDL/data changes require a backup and
separate rollout/rollback review. `prisma/deploy-db.ts` remains a maintenance
script with data/storage side effects and is removed from the build chain.

Roll back application code to the previous known-good Vercel deployment through
the approved path. Source revert does not reverse data changes; never reset or
reseed production as rollback. Payment/email remain simulated. Dependency
advisories remain a separate release review item; functional tests do not prove
zero vulnerabilities or commercial readiness.
