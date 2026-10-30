# PostgreSQL release gates

User decision: use PostgreSQL for development, tests, benchmarks and production; SQLite support is retired. Merge/deploy only after verification. Production CD requires approval by `coderuit3k`.

| Change | Current gap | Acceptance |
|---|---|---|
| PostgreSQL default | SQLite default/client and file fixtures | One PG client; isolated schemas per test suite; no skipped PG tests |
| Browser journey | Legacy SQLite Playwright setup | Local PG E2E DB, safe seed, all browser specs pass |
| CI | No workflow | Exact lockfile install, typecheck, both TZ suites, scripted eval, E2E on PostGIS service |
| CD | Vercel Git build mutates DB automatically | Disable Git auto-deploy; successful CI SHA only; production environment approval by coderuit3k |
| Release | Ten unmerged PRs | Test integrated candidate, merge reviewed changes, stop deployment at approval gate |

Tests use only explicit `TEST_DATABASE_URL` to a database ending `_test`; generated schemas are created/dropped per suite. E2E gets a separate local test database. Never seed/push the existing PostgreSQL database as a test. Canonical schema has no model changes beyond provider selection; deploy DDL/catalog effects require reviewed release plan and backup/rollback evidence.

Runtime rollback is the previous Vercel deployment. Source changes can be reverted; a source revert does not undo production data changes. Existing production data and schema are not changed during preparation. The production deployment gate is not self-approved by the agent.
