# AI assistant — evaluation report

Measured on 2026-10-27/28 in this workspace (local machine, fixture
databases), plus a live production battery on 2026-10-28 (§5).
Conditions are stated next to every number.

## Test layers and results

### 1. Unit / contract tests — 299/299 passing (whole repo suite)

`npm test` → 28 files, **299 tests, 0 failures** (10 PostgreSQL
tests skip without a PG URL: 4 AI + 6 geo). The tests added for the
assistant (`tests/ai/`):

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

### 5. Live production battery — 2026-10-28 (real model, real data)

Ten hand-written cases against `POST /api/assistant` on production
(Bedrock Haiku 4.5, prompt v5): **7 PASS · 3 PARTIAL · 0 FAIL**,
USD 0.1466 total, per-turn latency 5.6–36 s. Full evidence and
case-by-case notes: `eval/ai/live-eval-2026-10-28.md`.

The three PARTIALs were all acted on the same day (prompt
`sportshub-assistant-v6`):

- **Booking handoff recovery is inconsistent** — the model sometimes
  degraded to a clarification after a handoff error instead of
  recovering via `get_venue_profile` (which succeeded in manual
  probes). Prompt v6 rule 9 now prescribes that recovery explicitly.
- **Review counts stated with no tool call** in one run (unverifiable
  numbers; a manual probe with the stats tool showed the true
  figures, 2 of 8). The orchestrator now enforces the stats call
  server-side (stats guard) — a digit-bearing final answer to a
  review-count question is rejected until
  `get_review_summary_stats` has succeeded in that turn.
- **English "District 7" search returned empty** despite District 7
  tennis venues existing: "District N" is now translated to the
  "quan N" needle and verified District 7 ward aliases (Tân Hưng,
  Phú Thuận, Phú Mỹ Hưng) were added to the address fallback.

Post-fix regression: suite 299/299, scripted benchmark 50/50.
Post-fix live re-probe: cases 2, 5 and 6 all pass after the fixes
(handoff recovery executed as prescribed; stats answered from the
tool with correct 2-of-8 figures and scope; District 7 returns
exactly its two genuine tennis venues). Case 1 gained two further
server-side safeguards: auto-fill of shortlist options the model
forgot to reference, and a slot-check guard that requires an
actual availability/price check before finalizing a shortlist
when date, start time and duration are already known. Details in
the live report file above.

## Release gates (proposed §12) — status

| Gate | Status |
|---|---|
| 0 authorization / unintended-mutation failures in suite | ✅ held (no-write tests + invariant across benchmark) |
| 0 hard-constraint violations on demo set | ✅ held on scripted benchmark |
| Price/schedule/count exactness on standard fixtures | ✅ 22/22 integration + schedule cases |
| Reference/simulated labels on all price/schedule outputs | ✅ tool warnings + UI labels + handoff labels (asserted in tests) |
| Citation support ≥ 95% | ⚠️ NOT MEASURED at claim level (corrected 2026-10-28): what is enforced and tested is *reference integrity* (every cited id exists in the tool-result registry; quotes hydrate from the DB) plus, since the hardening round, *citation scope* (cited evidence must belong to the answer's venue and overlap the citing sentence's aspects). "5 valid evidence ids" is a reference-integrity observation, NOT a support measurement. Claim-level support (does the quote actually entail the claim) has no automated measurement yet → this gate is OPEN, not passed |
| Citation coverage ≥ 95% | ⚠️ NOT MEASURED (corrected 2026-10-28): no instrument counts "claims that need a source" vs "claims carrying an adequate source". The live battery case-4 observation (5/5 cited items reference-valid) does not measure coverage → gate OPEN |
| E2E task success ≥ 90% on the initial benchmark | Scripted benchmark 100% (protocol/orchestration, NOT model quality). Real-model: live battery 2026-10-28: 7 PASS / 3 PARTIAL / 0 FAIL on 10 hand-written cases (PARTIALs fixed in prompt v6, see §5) — a small hand-checked sample, not a ≥90% measurement over the 50-case set. The real-model runner now classifies outcomes as success / partial / safe_fallback / fail and never counts an honest fallback as success; a full 50-case real-model run remains UNMEASURED (needs local AWS credentials) |
| Ambiguous/missing-data cases handled | ✅ scripted + live (clarification, scope refusal, budget honesty, out-of-catalog geography) |
| p95 ≤ 12 s for the normal read flow | ❌ not met live: simple turns 5.6–9.7 s, but the full search+compare turn takes ~33–36 s (many model rounds, first-attempt tool errors self-corrected) |

## Go / no-go

**GO for a scripted/internal demo** of the full flow (search →
evidence → schedule/price → handoff) with the fixture dataset or a
configured model in a sandbox.

**Update 2026-10-28:** the assistant has been live on production
(Bedrock, credentials in Vercel env) since 2026-10-27 by the
project owner's decision, and the live battery in §5 supplies the
real-model evidence this section originally waited for: the full
demo flow completes end-to-end, scope/injection cases behave, and
the three PARTIAL findings were fixed in prompt v6 with a
server-side stats guard and District 7 matching. The one gate that
remains clearly unmet is **latency** (full turns ~33–36 s vs the
proposed p95 ≤ 12 s). `run-benchmark-real.ts` over all 50 cases is
still unrun (it needs AWS credentials in the local environment);
the 10-case live battery stands as the real-model measurement
until then.

### 6. Hardening round — 2026-10-28 (audit fixes, branch only, not deployed)

A security/correctness audit of the shipped assistant produced
findings A–J; the fixes below are implemented in code with regression
tests on `feat/ai-assistant`. They have NOT been deployed or merged,
and the real-model battery has NOT been re-run against them (no AWS
credentials in this environment) — quality claims for the new build
are therefore limited to the scripted/unit/integration layers.

| Finding | Fix | Proof |
|---|---|---|
| A. Validation checked ids, not claim content | Server-side grounding checks over the final prose: every number must trace to a tool fact (venue cards, options, comparison rows, handoffs, **registered stats results**); price provenance labels cannot be upgraded in prose ("giá chính thức"); cited evidence must match the answer's venue and the citing sentence's aspects. Trace now separates schemaValid / referencesValid / grounding | orchestrator tests: fabricated price+count beside a VALID evidence id → blocked (referencesValid=true, grounding=failed); cross-venue citation → blocked; staff review cited for a cleanliness claim → blocked; all-facts final → grounding=passed |
| B. ConversationId was the only access control | Principal-scoped conversation store (session user, or HMAC-signed anonymous cookie); client-carried context honoured only with a signed context token binding principal+conversation+state+history-hash; unverified context is ignored wholesale | session unit tests (tamper/expiry/replay) + orchestrator tests (other principal → fresh conversation, no state/history leak) |
| C. compare turned sub-tool errors into "no available option" | Per-venue QuoteOutcome (available / unavailable / price_unavailable / unknown_due_to_error / not_checked) with errorCode + checkedAt; envelope degrades to `partial`; `no_available_option` only from a completed quote query; profile failure of one venue degrades instead of sinking the comparison | integration tests: budget-exhausted quote → unknown + partial; no-price-rules facility → price_unavailable (never 0); one bad profile → partial; locked slot → genuinely unavailable |
| D. Failed evidence inputs burned evidence rounds | Evidence rounds count only executions that gathered data (status ≠ error); failed attempts stay bounded by the total tool budget + model rounds | orchestrator test: INVALID_INPUT stats call, then valid stats, within maxEvidenceRounds=0; the *next* gathering call is refused |
| E. Prompt listed only tool field names | Tool specs are generated from the runtime Zod schemas (types, required, enums, bounds, nested objects, hand-written check messages); prompt bumped to `sportshub-assistant-v7` | prompts unit tests pin enums/bounds/required/nesting |
| F. Citation `#review-<id>` anchors did not exist | Google review articles on the venue page now render `id="review-<id>"` + `scroll-mt-24`; in-app evidence (not rendered as articles) no longer fabricates an anchor — its citation target is the venue page itself | integration test asserts per-source targets; Playwright spec `tests/e2e/assistant-citation.spec.ts` verifies the anchor element exists in the browser and the assistant citation link lands on it |
| G. Real-model runner counted honest fallback as hard-pass | Runner classifies per-case outcome success / partial / safe_fallback / fail; safety and task outcome are separate axes in the report and the gate | code in `eval/ai/run-benchmark-real.ts`; a re-run is still UNMEASURED (credentials) |
| H. Citation conclusions overstated | Gate rows above corrected: reference integrity ≠ support ≠ coverage; support/coverage at claim level are OPEN/unmeasured | this table |
| I. Latency | Schema-complete tool specs + first-attempt-success tracing attack the largest measured waste (input-error repair rounds). No new latency number is claimed: the ~33–36 s full-turn figure from §5 stands until a post-hardening live run measures otherwise | trace field `firstAttemptToolSuccess`, `repairCount` |
| J. Freshness / deadlines / trace completeness | Slot-defining state changes (date, start, duration, sport, district, budget, venue set) invalidate registry options/handoffs/comparison; token/cost accounting is centralized in `finish()` so every exit path records usage; per-turn token budget (`AI_MAX_TOTAL_TOKENS`, checked between rounds — one-round overshoot possible) and per-call output cap (`AI_MAX_OUTPUT_TOKENS`); tool-timeout timers are cleared after the race | orchestrator tests: stale option after a 17:00→20:00 change is rejected; provider failure after a tool call still records tokens + cost; token budget stops further rounds |

Residual limits, stated plainly: (1) grounding checks bound numeric
claims, provenance labels and citation scope — they do NOT decide
semantic entailment of arbitrary prose; a number-free false claim
can still pass automated checks, which is why review answers are
quote-first with inline citations and the trace never claims more
than `grounding.status`. (2) Venue cards/evidence in the registry
can be up to a conversation old; slot-bearing artifacts are
invalidated on state change and handoffs re-quote freshly, but a
review deleted mid-conversation is only detected on re-fetch.
(3) The request deadline is enforced between rounds; a single model
call is bounded by `AI_MODEL_TIMEOUT_MS` with provider abort, and a
tool by `AI_TOOL_TIMEOUT_MS` via Promise.race — an underlying DB
query is not cancelled, only abandoned.
