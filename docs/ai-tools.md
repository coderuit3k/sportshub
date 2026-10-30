# AI tools — contracts

All seven tools live in `src/lib/ai/tools/`, are registered in
`src/lib/ai/tools/index.ts`, take `(ctx, input)` with an injectable
Prisma client + clock + shared budget, and return the common envelope:

```ts
{ status: "ok" | "empty" | "partial" | "error",
  data, appliedFilters, checkedAt, dataAsOf,
  warnings[], provenance{}, evidenceRefs[], error: {code, message} | null }
```

Inputs are Zod schemas (`src/lib/ai/schemas.ts`) with hard bounds
(result limits, durations 1–6h, ≤3 venues for evidence/compare).
All tools are READ-ONLY and re-check venue visibility
(`status = APPROVED`) server-side on every call. DTOs are minimal —
no Prisma entities, no owner email/phone, no user records reach the
model.

## search_venues
Structured candidate search over public venues.
- Diacritic-insensitive name/district matching (folded text) — same-
  named venues are all returned with district + address.
- District matching falls back to the address when the district
  column misses (most imported venues have an empty/ward-level
  district): the district text — or a curated ward alias
  (`DISTRICT_ADDRESS_ALIASES`, e.g. Thủ Đức → Linh Xuân / An Khánh /
  Bình Trưng, tokens verified against catalog addresses) — is
  matched inside the address, and any fallback-only match is
  disclosed in `warnings` as an address-text match, not verified
  geography.
- Rating filter/sort use the effective rating (`googleRating ??
  ratingAvg`, the shared `effectiveRating` helper).
- `maxReferenceHourlyPrice` compares the venue's MINIMUM reference
  hourly price (orientation only, labelled `minReferenceHourlyPrice`).
- Amenities: for venues whose amenity list is not owner-verified the
  condition is returned in `uncheckedConditions` — never treated as
  satisfied, never silently dropped.
- No location input exists by design; "near me" is resolved to a
  district by clarification, never by coordinates.

## get_venue_profile
One public venue by id or slug: identity, sports, facilities per sport
(with per-facility minimum reference price), operating hours,
cancellation policy, Google rating/count and in-app rating/count as
separate figures, `verificationStatus`, and per-field `provenance`.
Missing data stays null.

## search_review_evidence
Verbatim review evidence for 1–3 venues.
- Retrieval unit = one review; the returned `quote` is the best
  matching CLAUSE and is an exact substring of the stored text
  (asserted in tests).
- Aspect/sentiment pairs are derived from the same clause by the
  versioned lexical taxonomy (`aspect-lex-v1`) — "Sàn trơn nhưng nhân
  viên nhiệt tình" yields court_surface→negative + staff→positive.
- `evidenceId` = the stored review id (stable across deploys for
  Google reviews — see ai-assistant.md). `citationTarget` is built
  server-side (`/venues/<slug>#review-<id>`).
- Google items have `publishedDate: null` + `relativeTimeRaw` — dates
  are never invented. In-app items carry their real `createdAt`.
- When both sentiments exist in the pool, a multi-item result keeps
  at least one of each side (diversity rule). A query that matches
  nothing returns `empty` — never an arbitrary clause.

## get_review_summary_stats
Counts with explicit scopes; the three populations are never blended:
Google AGGREGATE (rating/count from the listing), stored Google TEXT
sample (distributions + aspect counts over the sample, sample size as
denominator), in-app reviews (seed rows counted separately and
excluded from organic figures). Aspect counts count reviews, not
chunks; a review positive and negative about one aspect counts as
`mixed` (disclosed). A time range over Google texts returns
`UNSUPPORTED_TIME_FILTER`; over in-app reviews it is applied to the
real `createdAt`.

## get_bookable_options
Live availability + exact quotes for one venue/date, computed by the
existing booking service (`getAvailability`) and pricing logic
(`calculatePrice`, `aggregateSlots`) — no re-implementation:
- a multi-hour option exists only when every consecutive hourly slot
  is free, inside opening hours, not past, not blocked/booked;
- totals are per-hour sums (peak crossings priced per hour), with the
  full breakdown; never `minPrice × duration`;
- budget checks honour `budgetBasis` (`per_hour` vs `total_session`);
- a facility without price rules yields `priceStatus: "unavailable"`,
  `totalPrice: null`, `meetsBudget: null` — never 0, never passing;
- never cached; every result carries `checkedAt` and
  `availabilityScope: "sportsHub_demo_schedule"` plus the
  reference-price warning.

## compare_venue_options
Composite service (not an agent): fans out to profile + stats +
bookable options under the SAME budget counter and lines results up
under identical date/duration/budget conditions. Output: a comparison
matrix, per-venue matched/unmet constraints, `unknownFields`, and
`dataCompleteness` (share of comparison fields that could be filled —
a statement about data, explicitly not a quality score). A venue's
minimum price is never compared against another's peak quote.

## prepare_booking_handoff
Prepares the confirmation card; performs **no writes** (a test counts
Booking/Payment rows before and after). It revalidates the exact
selection freshly (slot still free, price present) and fails with
`SLOT_UNAVAILABLE` / `PRICE_UNAVAILABLE` otherwise. The booking URL is
generated server-side from the venue slug + validated selection and
lands in the existing booking widget pre-filled (facility, date,
start, duration); the user confirms there, logged in, under the
widget's own revalidation. Labels state the price is a platform
reference, the schedule is simulated, and the quote does not hold
the slot. The handoff includes the venue district and the policy
summary's provenance for grounding policy claims. A changed selection
produces a new handoff id.
