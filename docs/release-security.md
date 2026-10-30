# Dependency security gate

The PostgreSQL release candidate initially reported 10 npm advisories. Release
merges are held until patched dependencies pass the same functional gates.

| Area | Patched version | Compatibility check |
|---|---|---|
| Zod | 4.6.7 | Public JSON Schema generation; two-argument records; patch fields remove defaults; AI/RBAC/input regression suite |
| Vitest | 5.0.5 | Node >=22.12; Oxc JSX automatic for TSX tests; PostgreSQL suite |
| Build dependencies | PostCSS8.5.32 / SWC helpers0.5.23 | Overrides apply to Next; valid npm10/11 peer tree and browser build |
| sharp | 0.35.5 | Override; native PNG smoke and browser image tests |
| deepmerge-ts | 8.0.2 | Override; Prisma generate/schema push/test setup with Prisma 6.19.3 |

Prisma and @prisma/client stay exactly 6.19.3. Next stays on major15. No audit
exception or suppressed advisory is introduced. CI checks `npm ls --all` and
`npm audit --audit-level=high`. The SWC helper pin prevents npm11 deduping a
version below next-intl's compiler peer requirement; lock generation uses npm10.
The lockfile pins resolved artifacts; overrides must be reviewed when parent
packages are upgraded rather than assumed compatible indefinitely.

Zod 4 changed default application inside optional properties. State patches now
reuse each validated field with its default removed; absent keys preserve the
existing conversation. The entry-point regression for changing district while
retaining sport caught this issue before release. JSON-schema issue names changed
from invalid_enum_value to invalid_value; diagnostics tests follow the library's
actual code and still forbid recording rejected values in the new schema field.

Tool descriptions use Zod's public input JSON Schema conversion instead of private
`_def` traversal. Required fields, enum values, nested booking windows, query bounds
and VND unit notes remain in the prompt. Prompt version is bumped to v11 because
description rendering can affect model behaviour; deterministic pass alone does
not establish real-model task completion.

Verification before push: npm reports zero vulnerabilities; Prisma6 generate,
typecheck,431 PostgreSQL tests at each timezone, scripted50/50 and native sharp
smoke pass. Browser, real-model and GitHub CI outcomes are recorded in the PR.
No production database operations are part of dependency installation or CI.

References: [Zod migration](https://zod.dev/v4/changelog),
[Zod JSON Schema](https://zod.dev/json-schema),
[Vitest migration](https://vitest.dev/guide/migration/).
