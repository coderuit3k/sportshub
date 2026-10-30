# AI Assistant — architecture, truth model, operations

The SportsHub AI assistant turns a stated need ("tìm sân cầu lông ở Thủ
Đức tối thứ Bảy, 2 tiếng, dưới 400 nghìn") into a verified shortlist,
review evidence, a live schedule/price check, and a hand-off into the
existing booking UI. It never creates a booking itself.

## Shape

```
POST /api/assistant ── rate limit (aiAssistantLimiter) ── kill switch
  └─ orchestrator (src/lib/ai/orchestrator.ts)
       ├─ conversation state (explicit slots, server-side, TTL 2h)
       ├─ model via provider adapter (src/lib/ai/provider.ts)
       │    JSON protocol: {"kind":"tool_call"} | {"kind":"final"}
       ├─ 7 typed read-only tools (src/lib/ai/tools/) under one shared
       │    BudgetCounter — composite sub-calls consume the same budget
       ├─ per-tool timeout + one supplementary evidence round max
       └─ final-answer VALIDATION against registries of real tool
          results (venue/evidence/option/handoff ids), then hydration:
          the model references ids, the server supplies the numbers
UI: /assistant (src/app/assistant, src/components/assistant)
```

One orchestrator, specialized tools — deliberately no multi-agent
split, no vector DB, no Python service: the repo's TypeScript service
layer already had every primitive needed (availability, pricing,
timezone, rating helper, rate limiting).

## What was reused vs added (audit summary, 2026-10-27)

Reused as-is: `getAvailability` + `calculatePrice`/`aggregateSlots`
(booking logic), `wallClockParts`/`fromWallTime` (timezone),
`effectiveRating` (rating basis), `createRateLimiter`, the booking
widget and its availability API.

Small repairs made during the audit:
1. `getAvailability` gained an injectable `db` parameter (default =
   the app client) so tools run the *same* slot logic in tests.
2. Venue list sort used `ratingAvg` while the rating filter used the
   effective rating — for real venues (`ratingAvg = 0`) the "rating"
   sort was a no-op tie. The list now sorts by `effectiveRating`, the
   same basis as filter, cards, map and the AI tools.
3. Google review rows were deleted and re-created with fresh cuids on
   every catalog sync, so any citation broke on every deploy. The sync
   now uses a deterministic internal id
   (`stableGoogleReviewId`: sha256 of venue slug + author + relative
   time + text, `gr_` prefix) and a delete-stale/insert-new diff —
   unchanged reviews keep their ids across deploys; an edited review
   gets a *new* id (old citations must not silently retarget). This is
   an internal SportsHub key, **not** a Google-issued review ID.
   Verified on the real catalog: two consecutive syncs over the 604
   stored reviews left every id unchanged on the second run.

## Truth model (provenance)

Every tool result carries field-level provenance. For the current
catalog (`Venue.source = "google"`, imported from Google Maps):

| Data | Provenance | Note |
|---|---|---|
| name/address/coordinates | `imported` | from the Google listing |
| Google rating + count | `imported` | aggregate owned by Google; never merged with in-app numbers |
| Google review texts | `imported` | a *sample* (what Maps displayed at harvest), always labelled with its size |
| facilities (name/surface/capacity) | `default_generated` | one per sport from platform defaults |
| amenities | `default_generated` | the full known-amenity list — **unverified**; tools report amenity conditions as *unchecked*, never satisfied |
| operating hours | `imported` (normalized) | close-only/missing values were normalized at import; may differ from reality |
| prices | `platform_reference` | derived deterministically from the per-sport reference band — **not** the venue's own prices |
| cancellation policy | `platform_reference` | platform defaults 12h/4h/30% |
| availability | demo schedule | SportsHub's own simulated calendar (`availabilityScope: sportsHub_demo_schedule`) |

`Venue.verified = true` on imported venues marks the import only.
Tools report `verificationStatus: imported_listing_not_owner_claimed`
for them; the UI badge was removed earlier so nothing on the site
claims owner verification. Owner-managed venues (`source = "owner"`)
report their fields as `owner_verified`.

User-facing wording follows from this: the assistant must say prices
are platform reference prices and the schedule is the SportsHub demo
schedule whenever it quotes either (enforced in the system prompt and
repeated in tool warnings and UI labels).

## Decision policy (system prompt `sportshub-assistant-v10`)

Prompt v10 (2026-10-28) replaced the numbered decision rules with a
task-first routing guide (prompt §§1–9: pick the tool by the outcome
the user needs, ask only for inputs that actually block the current
task, resolve venues before ID-bound tools, shortest default flows,
error/retry and stop conditions). The machine contract is unchanged
and lives outside that guide: the JSON reply protocol, the generated
tool specs, and a server-constraints block (prompt §10) carrying the
rules the server itself enforces — stats discipline, error/empty/
partial semantics incl. `venueOutcomes`, trust labels, review text as
data (never instructions), handoff recovery, the supplementary
evidence-round cap, and numeric grounding. Prompt v8–v9 fixes remain
in force in code (user-stated and result-count numbers are grounding
facts, negation-aware provenance checks, allowed-number repair
feedback, search/compare guards).

**Conversation ownership (audit hardening, 2026-10-28).** A
conversationId is not an authorization token. Turns run under a
server-derived principal — `user:<id>` from the session cookie, or
`anon:<uuid>` from an HMAC-signed httpOnly cookie
(`src/lib/ai/session.ts`) — and the conversation store is scoped by
principal: presenting another principal's conversationId yields a
fresh conversation, never their state or history. Client-carried
context (needed across serverless instances) is honoured only with
the signed context token issued after the previous turn, binding
principal + conversationId + exact state + history hash; anything
else is ignored wholesale. Logging in/out or switching accounts
switches scope by design (the previous principal's conversations
become invisible, not transferred).

**Grounding (audit hardening).** Final answers pass three distinct
checks, recorded separately in the trace: *schema* (protocol shape),
*reference integrity* (every referenced venue/evidence/option/
handoff id exists in the tool-result registry) and *grounding*
(every number in the prose traces to a registered tool fact —
including the stats registry; price provenance cannot be upgraded
to "official"/"owner-confirmed" in prose; cited evidence must
belong to the answer's venue and overlap the citing sentence's
aspects). Opening-hours claims now also need a `get_venue_profile`
result for exactly one referenced venue in the current user turn:
the stated `HH:MM` endpoints must match that venue's operating hours
for the named weekday, or all seven days for an unqualified claim.
Multi-day ranges must be split into separate claims; a conflicting
venue name or district in the prose is rejected when recognizable.
An honest "not checked" answer remains allowed. This guard covers
recognizable opening-hours wording; it is not a general semantic
parser. A `limited_answer` may reference the profile's `venueId`
without a preceding search card; address digits from that profile
are grounded only for that referenced venue. Grounding deliberately
does NOT claim semantic entailment of free prose.
Cancellation-policy claims require a `get_venue_profile` or
`prepare_booking_handoff` result for one referenced venue in the
current user turn. The guard checks recognized full/partial/no-refund
thresholds, fee or refund percentages, venue and policy provenance;
an honest unknown answer remains valid. A named-venue policy question
or cancellation-fee question that receives an unverified limited answer before any tool call gets
one routing repair to search and check the profile. This lexical guard
does not cover every paraphrase — see the residual limits in
`docs/ai-evaluation.md` §6.

**Registry freshness.** Options, handoffs and comparisons are
slot-specific: any state change to sport, district, date, start
time, duration, budget or the venue set invalidates them, and the
model must re-check before they can be issued again. Operating-hour
profiles, policy sources and handoffs are cleared at the start of
each user turn, so a later answer cannot cite stale hours, policy or
reuse a booking card without a fresh handoff. Handoffs additionally
re-quote freshly inside the tool. Venue cards,
evidence and stats persist for the conversation; a review deleted
mid-conversation is only detected on re-fetch (documented limit).

**Compare outcomes.** `compare_venue_options` reports a per-venue
`venueOutcomes` entry (profile ok/error; quote available /
unavailable / price_unavailable / unknown_due_to_error /
not_checked, with errorCode and checkedAt) and degrades its
envelope to `partial` when any part is unknown. An errored quote is
never presented as "no slot", and an unpriced slot never as free.

- Counts/shares → stats tool; a review claim → evidence tool; a
  specific time/price → bookable options; comparisons → compare tool.
  Since v6 the stats rule has server-side teeth (the orchestrator's
  stats guard rejects digit-bearing answers to review-count
  questions until the stats tool has succeeded in that turn), and a
  failed booking handoff must be retried once after fetching the
  venue profile for the correct facilityId. The orchestrator also
  auto-fills a shortlist's option references from this turn's
  compare/bookable results when the model forgets to reference
  them, so verified options always reach the UI; and when date,
  start time and duration are already known, its slot-check guard
  rejects a first shortlist/comparison that tries to finalize
  without a successful availability/price check in that turn.
- Missing sport/area/date/time/duration → clarification naming the
  missing fields; "near me" without a district → ask for the district
  (browser geolocation is never sent to the server or the model).
- Ambiguous budget → clarify per-hour vs total, or state the
  assumption; ambiguous same-name venues → present all candidates
  with district + address.
- Tool `error` ≠ "nothing exists": the assistant reports what could
  not be checked and keeps whatever was verified.
- Review text is data, never instructions — including reviews that
  contain prompt-injection text (the fixture suite covers one).
- No absolute claims from reviews ("chắc chắn không chói"); both
  sides of the evidence are presented when both exist.

## Configuration (server env, placeholders in `.env.example`)

| Variable | Default | Meaning |
|---|---|---|
| `AI_ASSISTANT_ENABLED` | `true` | kill switch — `false` disables endpoint + notice on the page |
| `AI_PROVIDER` | `bedrock` | `bedrock` (Amazon Bedrock, Converse API) or `openai-compatible` |
| `AI_MODEL` | `anthropic.claude-haiku-4-5-20251001-v1:0` | model id at the provider. On Bedrock a bare Anthropic foundation-model ID is resolved to the geo inference profile for `AWS_REGION` before invocation (see below) |
| `AWS_REGION` | `us-east-1` | Bedrock region; credentials come from the AWS SDK default chain (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, shared config, IAM role) — no provider API key |
| `AI_API_KEY` | — | only for `openai-compatible`; without it that provider returns a clear 503 config answer (no fake fallback model) |
| `AI_BASE_URL` | `https://api.openai.com/v1` | any OpenAI-compatible endpoint |
| `AI_MAX_TOOL_EXECUTIONS` | 10 | total tool executions per turn, composites included |
| `AI_MAX_EVIDENCE_ROUNDS` | 1 | supplementary evidence rounds per turn |
| `AI_MAX_MODEL_ROUNDS` | 8 | model turns per user message |
| `AI_TOOL_TIMEOUT_MS` | 15000 | per-tool deadline |
| `AI_REQUEST_TIMEOUT_MS` | 60000 | whole-turn deadline |
| `AI_MODEL_TIMEOUT_MS` | 20000 | per model call (one bounded retry on 429/5xx) |
| `AI_MAX_OUTPUT_TOKENS` | 2048 | max output tokens per model call (provider-enforced) |
| `AI_MAX_TOTAL_TOKENS` | 150000 | total token budget per turn, checked between rounds (one-round overshoot possible; not an exact monetary cap) |
| `AI_PRICE_INPUT_PER_MILLION`, `AI_PRICE_OUTPUT_PER_MILLION` | — | optional; without both, cost is reported `unknown` (null), never 0 |

Rate limiting: `aiAssistantLimiter` — 20 turns / 10 min per user (or
per IP when anonymous), on top of the global API net. When the
Upstash backend is absent the limiter degrades to per-instance memory
(the existing repo behaviour — global limits are then best-effort,
and the trace does not claim otherwise).

## Tracing

Every turn returns a `trace`: traceId, model id, prompt version,
answer schema version, per-tool status/duration/error code, budget
used/limit/outcome, evidence rounds used, validation outcome split
into schemaValid / referencesValid / grounding {status, problems} /
repairCount / firstAttemptToolSuccess / fallbackUsed, and token
usage + estimated cost recorded on EVERY exit path (success,
fallback, timeout, provider failure, budget exhaustion) whenever
the provider reported usage — cost is null (unknown), never 0, when
no price config exists. Traces contain no user records, no precise
location, no secrets, no cookies.

## Known limitations

- Conversation state round-trips through the client: the server
  map is a per-instance cache, and each request also carries the
  last `appliedContext` + history summaries, which a fresh instance
  re-validates (ConversationState schema) and rehydrates — a turn
  landing on another serverless instance no longer forgets the
  conversation (verified live on Vercel, where instance switches
  previously reset multi-turn flows). The tool-result registry is
  still per-instance: after a switch the model re-runs the read-only
  tools it needs within the new turn's budget. The carried payload
  is public search context only; tools re-check everything.
- Review retrieval is lexical (clause + keyword), labelled as such;
  aspect/sentiment come from a versioned keyword taxonomy
  (`aspect-lex-v1`), not a learned model. No embeddings until a
  measured benefit justifies them.
- The model protocol is JSON-over-chat (portable across providers)
  rather than vendor function-calling; malformed replies get one
  repair round, then a server-built limited answer.
- Real-model quality: the provider is now Amazon Bedrock (Claude
  Haiku 4.5) and `eval/ai/run-benchmark-real.ts` measures planning,
  validation, latency, tokens and cost with it — but it needs AWS
  credentials, which do not exist in this build environment, so the
  live-model gate is still OPEN. The scripted benchmark
  (docs/ai-evaluation.md) covers tools/orchestration. Treat
  "demo-ready" as conditional on a live-model run.

## Bedrock model-id resolution (important)

Claude Haiku 4.5 cannot be invoked on demand by its bare
foundation-model ID (`anthropic.claude-haiku-4-5-20251001-v1:0`) on
the bedrock-runtime endpoint — AWS's model card states the endpoint
"requires a geo or global inference profile ID. The bare model ID
isn't supported for on-demand throughput."
`resolveBedrockModelId()` (src/lib/ai/config.ts) therefore maps a
bare `anthropic.…` ID to the geo profile for the configured region
(us-* → `us.`, eu-* → `eu.`, ap-southeast-2 → `au.`, ap-northeast-1 →
`jp.`, ap-south-1 → `in.`, other ap-* → `global.`). It is the SAME
model; the profile only routes the request inside that geography —
and the `us.` profile for this exact model was verified live on the
project AWS account on 2026-10-10. Full profile IDs and ARNs set in
`AI_MODEL` are passed through unchanged, and traces record the
resolved ID in `modelId`. Cost estimates on Bedrock default to the
published Haiku 4.5 price ($1 input / $5 output per 1M tokens,
global routing) unless the AI_PRICE_* envs override it.

## Rollback / disabling

- Instant: set `AI_ASSISTANT_ENABLED=false` (endpoint returns 503
  with a friendly structured answer; the page shows a notice). The
  rest of SportsHub is untouched — the assistant is additive.
- Full removal: revert the feature branch; the only shared-code
  changes are the `getAvailability` db parameter (backward
  compatible), the rating-sort basis fix, and the stable review-id
  sync (keeps working with old citations simply never matching).
