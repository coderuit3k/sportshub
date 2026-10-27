# AI assistant — evaluation report

Measured on 2026-10-27 in this workspace (local machine, fixture
databases). Nothing here is a production measurement; conditions are
stated next to every number.

## Test layers and results

### 1. Unit / contract tests — 293/293 passing (whole repo suite)

`npm test` → 27 files, **293 tests, 0 failures** (4 PostgreSQL tests
skip without `AI_TEST_PG_URL`). The 54 tests added for the assistant
(`tests/ai/`):

- `unit.test.ts` (9): diacritic folding; clause splitting keeps exact
  substrings; aspect–sentiment pairs stay inside one clause (the
  spec's "Sàn trơn nhưng nhân viên nhiệt tình" example); short-keyword
  false-positive guard; `stableGoogleReviewId` determinism, edit →
  new id, per-venue/author separation; budget counter semantics.
- `tools.integration.test.ts` (22) against a throwaway SQLite fixture
  DB with hand-computed expectations: both same-named venues returned;
  effective-rating filter (Google 4.6 passes ≥4.5 while `ratingAvg`
  is 0); non-public venue invisible everywhere; amenity conditions
  unverified for imported venues; profile provenance per field; no
  private fields in any payload; evidence quotes verbatim substrings;
  lighting evidence contains both sides; stats keep Google aggregate
  (1200) separate from the stored sample (5) and seed reviews
  separate from organic; aspect counts with sample denominators;
  `UNSUPPORTED_TIME_FILTER` for Google texts; booked/blocked/past
  slots unavailable; multi-hour across a block unavailable; peak-
  boundary session priced 80k + 120k = 200k (not min×2); budget basis
  per-hour vs total honoured; missing price rules → null price;
  comparison under identical conditions with per-venue budget
  verdicts; handoff happy path + taken slot + unpriced venue; handoff
  writes zero Booking/Payment rows.
- `orchestrator.test.ts` (8) with a scripted model: full Demo A chain
  with hydration from tool results; hallucinated evidence id rejected
  → limited answer built from verified data; tool errors reach the
  model as errors (never as "empty"); total tool budget enforced
  across the turn (composite sub-calls included); supplementary
  evidence rounds capped; newer user information overrides older
  state slots; handoff via orchestrator creates no booking; unknown
  conversation ids start fresh.
- `bedrock.test.ts` (9) with a fake Converse client: Bedrock config
  defaults (provider, Haiku 4.5 model, us-east-1, $1/$5 price);
  inference-profile resolution (bare ID → geo profile per region;
  profiles/ARNs/other models untouched); system extraction, tool→user
  mapping and same-role merge in Converse messages; usage mapping;
  one bounded retry on throttling; missing AWS credentials → typed
  `config` error; validation errors not retried; empty completion →
  `bad_response`.
- The pre-existing 225 tests still pass, including the rate-limit
  route-coverage manifest (the new `/api/assistant` route is
  classified there with its own limiter).

### 2. PostgreSQL behaviour tests — 4/4 passing (local PostgreSQL 16)

`tests/ai/tools.pg.test.ts`, gated on `AI_TEST_PG_URL` (skipped
without it), run on 2026-10-27 against a throwaway local PostgreSQL
16 database with the repo's `schema.postgresql.prisma` pushed and the
SAME fixture design + hand-computed expectations as the SQLite
suite: effective-rating search, population-separated stats,
booked/blocked availability conflicts, peak-boundary pricing
(80k + 120k = 200k), and handoff freshness + no-write. **4/4
passed.** Two environment notes: the PG-flavoured Prisma client is
generated into a temp output for these tests (the app client is
SQLite-flavoured and rejects `postgresql://` URLs), and the tsrange
exclusion constraint is *not* re-tested here — it is applied by
`prisma/deploy-db.ts`, not by `db push`, and its behaviour was
verified on production PostgreSQL in earlier work.

### 3. Scripted benchmark — 50/50 (dev 34/34, holdout 16/16)

`npx tsx eval/ai/run-benchmark.ts` → `eval/ai/report.md`:

- 50 conversations (20 search, 10 review/compare, 10 schedule/price,
  10 ambiguous/error/attack), fixed fixture snapshot, symbolic
  next-Saturday/Friday dates so the dataset cannot rot.
- **50/50 passed**, no-write invariant held (booking/payment counts
  unchanged across the whole run), stability re-run agreement 10/10.
- Orchestration latency p50 4 ms / p95 16 ms — local, scripted model,
  fixture DB. This says nothing about production latency with a real
  model; the p95 ≤ 12 s target for the read flow remains **unproven**
  until a provider key exists.

**What this benchmark does NOT measure:** with a scripted model it
grades tools, protocol validation, budgets and answer assembly — not
the real LLM's planning, Vietnamese understanding, or clarification
quality. Those gates are open (see below).

### 4. Real-model benchmark — runner ready, live run blocked on credentials

`npx tsx eval/ai/run-benchmark-real.ts` runs the same 50 cases'
user turns against the configured production provider (Amazon
Bedrock, Claude Haiku 4.5, Converse API) and scores HARD checks
(no-write invariant, forbidden patterns, validated-or-honest-fallback
answers) separately from scripted-expectation matches (diagnostics
only), recording per-case latency, tokens and estimated cost.

Status on 2026-10-27: the provider probe resolves the configured
model `anthropic.claude-haiku-4-5-20251001-v1:0` to
`us.anthropic.claude-haiku-4-5-20251001-v1:0` (the inference profile
Bedrock requires for on-demand invocation of this model — the same
profile verified live on the project AWS account on 2026-10-10) and
fails only with the typed error "AWS credentials not available":
**this build environment holds no AWS credentials** (no env keys, no
shared config, no CLI). The live run — and with it citation coverage,
real-model E2E success and p95 latency — remains unmeasured until
AWS keys are placed in the server env (`.env` locally, Vercel env in
production). No number is claimed for it here.

## Release gates (proposed §12) — status

| Gate | Status |
|---|---|
| 0 authorization / unintended-mutation failures in suite | ✅ held (no-write tests + invariant across benchmark) |
| 0 hard-constraint violations on demo set | ✅ held on scripted benchmark |
| Price/schedule/count exactness on standard fixtures | ✅ 22/22 integration + schedule cases |
| Reference/simulated labels on all price/schedule outputs | ✅ tool warnings + UI labels + handoff labels (asserted in tests) |
| Citation support ≥ 95% | ✅ by construction: server validates every cited id against the evidence pack and hydrates quotes from the DB; a fabricated id cannot render (tested) |
| Citation coverage ≥ 95% | ⚠️ defined over model behaviour — measurable only with a real model |
| E2E task success ≥ 90% on the initial benchmark | ✅ 100% scripted; ⚠️ real-model success unmeasured |
| Ambiguous/missing-data cases handled | ✅ scripted (clarifications, abstentions, unsupported-filter honesty) |
| p95 ≤ 12 s for the normal read flow | ❓ unproven — needs AWS credentials in env + a `run-benchmark-real.ts` run |

## Go / no-go

**GO for a scripted/internal demo** of the full flow (search →
evidence → schedule/price → handoff) with the fixture dataset or a
configured model in a sandbox.

**NO-GO for customer-facing production** until: (1) AWS credentials
are configured and `run-benchmark-real.ts` passes its hard checks
with the real Bedrock model (including clarification quality and
citation coverage from its expectation diagnostics), and (2) a
live-model latency check (p95) is recorded. The PostgreSQL fixture
gate has since been closed (see §2: 4/4 on local PG 16) and the
provider is implemented + unit-verified (see §1, §4). The remaining
blocker is a verification step that needs AWS credentials in the
environment, not code.
