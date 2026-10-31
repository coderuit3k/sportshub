# SportsHub CI/CD audit and design

## Direction selected by the user

GitHub standalone build → staged test → approval → promotion. The user additionally
requested upgrading packages and technologies to the latest stable releases.
This explicitly supersedes the earlier Next15/Prisma6/Tailwind3 constraints.
Keep npm, PostgreSQL, data, auth/provider abstractions and business behavior.
Preserve uncommitted files; remove temporary branches after merge so only main remains.

### Stable targets verified on 2026-10-31

| Area | Target |
| --- | --- |
| Web framework | Next16.4.3, React/react-dom19.3.1, next-intl4.14.9 |
| Data client | prisma/@prisma/client/@prisma/adapter-pg7.10.1, pg8.23.1 |
| Runtime/tooling | Node26.13.0 LTS, TypeScript7.0.2, ESLint10.14.0, eslint-config-next16.4.3 |
| CSS | Tailwind/@tailwindcss/postcss4.3.3, PostCSS8.5.32 |
| CD | VercelCLI65.9.0, pinned GitHub action revisions |

Upgrade all remaining direct packages to verified stable versions and remove
obsolete dependencies/overrides when no longer needed. Do not blindly trust npm
latest: prisma currently points to 8.0.0-rc.29; select stable7.10.1. No beta/RC. Never suppress TLS verification to make a deployment green.
Node26 is supported on Vercel; align CI, build and runtime to26.x. TypeScript7
lacks the old stable compiler API; use Microsoft's documented TypeScript6 API
compatibility package where Next/ESLint need it, with the TS7 compiler for tsc.
Verify tsc reports7.x while the legacy compiler API import reports the expected6.x.

### Compatibility work required before CI/CD rollout

Prisma7 uses the PostgreSQL JS driver adapter instead of the native Rust query
engine. Migrate every Prisma constructor, scripts, isolated schema factory and
CLI config/flags and ESM entry points together (require.main, CommonJS PostCSS
config, vitest __dirname). Keep every intermediate PR buildable. Preserve secure
TLS certificate verification, bounded pool/connect behavior and explicit test
schema isolation, pool cleanup,
exclusion constraints, transactions and timezone semantics. Compare schema models
and require no production DDL/data migration; never run schema push on production.
Replace obsolete RHEL binary guards with generated client/adapter/runtime checks.

Next16 changes middleware/proxy conventions and default build tooling. Preserve
RBAC, API limiter behavior, cookie locale URLs and public cache semantics.
Tailwind4 requires the dedicated PostCSS plugin and CSS migration; preserve theme
tokens, dimensions, accessibility and mobile layout. No redesign. Keep existing
positive/negative tests and add regressions for real migration failures.

### Five small PRs, in order

1. Prisma7 + PG adapter/config/fixtures; all PostgreSQL and timezone tests.
2. Next16/React19/Node26/TypeScript7 + compatible stable application packages;
   build, routing/auth/cache/AI regressions and browser journeys.
3. Tailwind4/PostCSS and remaining stable package cleanup; mobile/desktop UI E2E.
4. ESLint10 and three CI gates; validate every command before making it required.
5. CD standalone plan/staged validation/approval/promotion and safe diagnostics;
   actual successful plan before requesting apply approval.

Pause the old CD trigger while these migrations are being reviewed; keep CI and
production approval protections. Re-enable only the reviewed replacement workflow.
Do not create or alter production DBs, managed DB versions, schema or catalog data.


## Audit

| Requirement | Current gap | Acceptance |
| --- | --- | --- |
| Three CI gates | One verify job; no ESLint config/script | Required lint-and-test, web-test, security |
| Plan before approval | Approval currently precedes build | Build and staged checks complete before apply review |
| Correct artifact check | Physical find ignores Vercel filePathMap | Standalone output; reject external references; verify runtime asset |
| Exact release approval | Build and deploy grouped after approval | Promote exact tested deployment ID and SHA without rebuilding |
| Runtime verification | Build success concealed runtime error | Staged health/discovery before approval; live health after apply |

The original deployed Prisma client lacked the RHEL target. Later guards also
made an incorrect assumption: Vercel CLI 65.8.0 filesWithoutFsRefs2 stores external
file references in .vc-config.json.filePathMap, and writeLambda copies only the
remaining files. Physical find alone did not prove the engine was absent from
the deployable map. --standalone copies dependencies into function output.
Those fixes describe the Prisma6 baseline only. Prisma7 migration removes the
obsolete binary target/tracing requirements once the JS adapter runtime is tested.

## CI: three independent jobs

1. lint-and-test: real ESLint, typecheck, all PG tests in UTC and
   Asia/Ho_Chi_Minh, scripted AI evaluation. No paid models.
2. web-test: isolated PG/PostGIS, production build, browser journeys and actual
   health/discovery generated-client and driver runtime regression.
3. security: clean lockfile install, npm ls --all and npm audit high gate.

Use pinned actions/CLI, a consistent Node major, synthetic credentials and
separate test databases. Preserve short-lived failure traces. Fix real lint
failures instead of hiding them. Replace required verify with all three contexts
only once those checks exist; keep admin enforcement and current-main protection.

## CD plan

Allow only successful CI for same-repository push on current main. Manual
runs must also verify successful CI for exactly that SHA. Reject stale, PR/fork,
failed and skipped checks. Inspect exact workflow identity and all three job
results using actions:read, not just aggregate conclusion. Plan uses environment vercel-plan, main only, without
approval. User supplies VERCEL_TOKEN and VERCEL_PROJECT_ID there; ORG_ID optional.
Existing vercel secrets cannot be read back or copied through GitHub API.
Plan also requires an existing VERCEL_AUTOMATION_BYPASS_SECRET for authenticated
smoke checks; never let the CLI silently create or change project bypass tokens.

Link the exact project; pull production config; build once using pinned
vercel build --prod --standalone. Verify self-contained function metadata, reject external filePathMap/symlink
references and verify generated Prisma client/adapter dependencies for the actual
upgraded runtime (not an obsolete RHEL filename), then vercel deploy --prebuilt --prod --skip-domain. This creates a
staged production deployment without moving production domains. Require existing
Deployment Protection for production deployment URLs before upload and verify an
anonymous staged request is denied afterward. Do not weaken project protection.
Check exact
project/account, deployment ID, release SHA metadata, production target and READY.
Use authenticated vercel curl for read-only health, homepage and discovery checks;
reject SSO HTML posing as a successful health response. No schema push, seed,
catalog sync, account/booking writes or model calls.

A safe job summary shows SHA, CI URL, deployment ID/URL, smoke results and previous
production deployment. Pass only validated metadata between jobs. Never upload
raw production build output, pulled env, secrets or production data to GitHub
artifacts. Failed plan never opens apply approval.

## CD apply

Apply needs successful plan and the existing vercel environment: coderuit3k
reviewer, main only, no admin bypass. The agent never approves. After approval,
re-check current main and deployment project/account/SHA/target/readiness.
Serialize production promotion, promote that exact staged production deployment,
and do not rebuild or re-upload source. Check production health after promotion.
Report failed health honestly; no automatic rollback, DB reset or reseed.

## Acceptance, rollout and rollback

Test missing/malformed/stale CI metadata, wrong project/account/SHA/target,
external artifact references, missing client/driver runtime assets, unsafe URLs
and SSO false positives. Preserve PostgreSQL schema isolation and all timezone
regressions through the driver migration.
Validate workflow syntax and local checks, run all three CI jobs, merge only when
green, inspect actual plan, then wait for user approval to apply. No schema/data
migration. Workflow/source rollback is a reviewed PR; application rollback uses
an existing deployment under separate approval, without DB changes.

## References

- https://vercel.com/docs/cli/build#standalone
- https://vercel.com/docs/cli/deploying-from-cli#deploying-a-staged-production-build
- https://vercel.com/docs/deployments/promoting-a-deployment
- https://vercel.com/docs/cli/curl

### Upgrade references

- https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7
- https://nextjs.org/docs/app/guides/upgrading/version-16
- https://tailwindcss.com/docs/upgrade-guide
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
