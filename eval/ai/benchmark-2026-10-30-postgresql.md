# PostgreSQL real-model release probe

Completed `2026-10-30T13:55:32.550Z`, Bedrock
`us.anthropic.claude-haiku-4-5-20251001-v1:0`, promptv11, Zod4.6.7,
Prisma6.19.3, local PostgreSQL18.6. Code under measurement: b6709d7;
5ebd386 subsequently corrects npm10 peer lock resolution for CI. The local
model run used the installed dependency tree before that clean-install fix;
CI separately validates the final lockfile on Node22. No fixed model seed.

50 identical case IDs / 51 user turns. `DATABASE_URL` was removed from the
runner environment; TEST_DATABASE_URL selected a local `_test` database.
The fixture created/dropped its own PG schema; no production DB was used.
Budgets:12 tool executions,1 evidence round,8 model rounds,120-second request
deadline,60-second model timeout. Token price estimate: $1/$5 per million
input/output tokens, including all turns; this is not an AWS bill.

| Outcome | Prior SQLite/promptv10 run | PostgreSQL/promptv11 run |
|---|---:|---:|
| Success | 42 | 39 |
| Partial | 6 | 8 |
| Safe fallback | 2 | 3 |
| Hard-check fail | 0 | 0 |
| Hard-check safety | 50/50 | 50/50 |
| p95 by case | 25358ms | 29498ms |
| Estimated full-run cost | $1.748043 | $1.822598 |

Booking/Payment count stayed unchanged. One run per configuration cannot
establish stability or attribute differences to PostgreSQL, Zod or prompt
rendering. The change does not demonstrate improved task completion.

Fallbacks: AI-034 and AI-050 exhausted repairs with protocol discriminator
errors; AI-039 repeatedly failed the opening-hours validator, including a
generic statement that hours were stored without actual endpoints. That
last case is a validator false-positive candidate, not evidence that hours
were absent. Preserve the safety guard until a focused regression-backed
fix is reviewed. Routing AI-036 and numeric clarification issues remain.
Some partials still differ from overly specific scripted expectations.
No rubric or outcome was changed to improve this score.

SHA-256:

| Artifact | Digest |
|---|---|
| cases.json | `8821ab8ee21bb27f798564255feacc5ae54096cc29f7dba16728c8cc296433cc` |
| fixtures.ts | `561f14094ace07e1ca855dbc7b59102d76b6983b73b2bf28845ad35ee84d74db` |
| prompts.ts | `3d4282932c58abb01403e294240216d3e16050a522639689b1d729e179d9129e` |
| raw report retained locally | `f24c590bc22f2bfeee7de227a78127ee6ecbcd0b28716685d2c2ef9a872adbe5` |

Functional CI/audit gates and the human deployment gate are separate from
these model-quality limitations. This is not a claim that the Assistant is
complete or every answer is factually correct.
