# SportsHub stable upgrade and CI/CD implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Upgrade the app to verified stable releases and ship through CI → standalone staged plan → user-approved promotion.
**Architecture:** Preserve app/service/database behavior. Use a shared PG adapter client factory, three CI jobs, and a two-job CD workflow that promotes an exact tested deployment.
**Tech Stack:** Node26.13.0, Next16.4.3, React19.3.1, Prisma7.10.1, Tailwind4.3.3, TypeScript7.0.2 with official API6 compatibility, ESLint10.14.0, Vercel65.9.0.
**Spec:** docs/superpowers/specs/2026-10-31-cicd-plan-apply-design.md (approved by user).

## Global constraints

- No beta/RC; Prisma CLI/client/adapter exactly7.10.1.
- PostgreSQL only, Asia/Ho_Chi_Minh business semantics, unchanged production models/data.
- No schema push/seed/catalog/storage mutation in production build or plan.
- CI lint-and-test/web-test/security must all pass; only coderuit3k approves apply.
- Standalone build, protected staged deployment, immutable ID/SHA promotion, no raw production artifact uploads.

## Review focus

- PG adapter schema/search_path/TLS/pool differences must not break isolation or booking concurrency.
- ESM and compiler API migration must preserve script entry points and actual checks.
- CSS/framework upgrades must preserve auth, locale URLs, mobile controls and accessibility.
- Missing/stale/wrong-project metadata and skipped CI must fail closed.
- External artifact references, unprotected staged URLs and SSO HTML must not pass plan checks.

### Task1 / PR: Prisma7 PostgreSQL adapter

Files: prisma.config.ts, schemas, shared client factory, all constructors/imports,
CLI helper flags, obsolete engine checks, DB isolation tests, deployment docs.
- [ ] Add PG/schema/URL safety regressions and observe baseline/migration failure.
- [ ] Install exact stable7.10.1 packages and configure generated client/PG adapter.
- [ ] Migrate every constructor and script, preserving schema, cleanup, TLS and timeouts.
- [ ] Generate; compare schemas; run typecheck,431 PG tests eachTZ, scripted50 and E2E.
- [ ] Review, commit, PR; merge only green and delete temporary branch.

### Task2 / PR: framework/runtime/compiler and stable app dependencies

Files: package/lock, Node pin, Next config, middleware/proxy, TS/API compatibility,
compiler/config entry points and affected callers/tests.
- [ ] Pin Node26 and verified stable Next/React/TypeScript + compatible package updates.
- [ ] Migrate actual breaking APIs without changing business guards or i18n URLs.
- [ ] Check native tsc7 and compiler API6 separately; run full relevant gates.
- [ ] Review, commit, PR; merge green and delete branch.

### Task3 / PR: Tailwind4 and remaining package cleanup

Files: package/lock, PostCSS, globals CSS/theme config, affected classes/docs.
- [ ] Use Tailwind4 PostCSS plugin and preserve design tokens/layout semantics.
- [ ] Remove obsolete dependencies and overrides only after replacement is verified.
- [ ] Run build, desktop/mobile UI/E2E and audit; fix actual regressions.
- [ ] Review, commit, PR; merge green and delete branch.

### Task4 / PR: three CI gates and real ESLint

Files: ESLint config/package scripts, workflows/ci.yml, actual lint fixes.
- [ ] Establish real lint baseline; fix errors without broad disabling or test skips.
- [ ] Configure independent lint-and-test/web-test/security with isolated PG services.
- [ ] Validate all commands locally and CI; update required contexts once new checks pass.
- [ ] Review, commit, merge green, delete branch.

### Task5 / PR: CD standalone plan and approved apply

Files: workflows/deploy.yml, release scripts, regression tests, deployment runbook.
Interfaces: validate exact GitHub CI+SHA; inspect standalone function manifests;
validate Vercel deployment identity; smoke health/content; promote exact candidate.
- [ ] Write tests for rejected metadata/references/URLs/SSO and valid release path.
- [ ] Implement bounded plan build/upload/read-only staged checks and safe summary.
- [ ] Implement gated apply with fresh identity/current-main checks and live smoke.
- [ ] Validate workflow syntax, all tests and actual plan; no apply until human approval.
- [ ] Review/merge green, enable reviewed CD replacement, delete branch, inspect production health after approval.

## Execution ledger

- Approved user direction and scope recorded. CD legacy workflow disabled; CI remains enabled.
- Design/builder review complete; no production data changes authorized or performed.

- Ruling: generated Prisma7 client uses documented moduleFormat=cjs with TS imports to preserve current script/config entry points; no package-wide ESM rewrite needed in PR1.

- PR1 evidence: 447 PG tests pass in UTC and HCM; schema/model diff empty; lazy-client regression red→green; raw/model schema isolation and safe URL/timeout/TLS guards pass. E2E and CI pending.

- PR1 review found URL TLS bypasses; regression red→green now uses the same pg parser (already installed, declared explicitly). Final full suite452pass bothTZ, typecheck/tree/audit0pass; exact-head E2E running.

- Ruling: last PR1 local E2E build hit Google Fonts timeouts (prior candidate23E2Epassed). No test bypass; require exact-head CI E2E green. PR2 will self-host the existing font families to remove this observed build-network dependency.
- vercel-plan secrets names verified: VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_AUTOMATION_BYPASS_SECRET. Values never read or logged.
