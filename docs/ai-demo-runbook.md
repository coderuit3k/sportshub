# AI assistant — demo runbook

## Local setup

```bash
npm install
cp .env.example .env          # SQLite defaults work out of the box
# the assistant runs on Amazon Bedrock by default — add AWS access to
# .env (an IAM user/role with bedrock:InvokeModel + Converse on the
# Claude Haiku 4.5 inference profile):
#   AI_PROVIDER=bedrock
#   AI_MODEL=anthropic.claude-haiku-4-5-20251001-v1:0
#   AWS_REGION=us-east-1
#   AWS_ACCESS_KEY_ID=<your access key>
#   AWS_SECRET_ACCESS_KEY=<your secret key>
# (the bare model ID is resolved to the us. inference profile
# automatically — Bedrock cannot invoke it bare on demand)
npx prisma generate
npx prisma db push
npm run db:seed               # ~1 min: accounts + the 119-venue real catalog
npm run dev                   # http://localhost:3000
```

Open http://localhost:3000/assistant (also linked in the header as
"Trợ lý AI"). Without AWS credentials the page renders, but the first
message returns a typed "AWS credentials not available" error — by
design; there is no fake demo model.

Sanity checks before presenting:

```bash
npm run typecheck
npm test                              # expect 293 passing (4 PG tests skip without AI_TEST_PG_URL)
npx tsx eval/ai/run-benchmark.ts      # expect 50/50 + no-write HELD
npx tsx eval/ai/run-benchmark-real.ts # real Bedrock model: needs AWS credentials in env
```

## Demo scripts

Dates: say "thứ Bảy này" — the assistant resolves relative dates
against Asia/Ho_Chi_Minh today. Venue names below are from the real
catalog; pick any badminton venue in Thủ Đức if PooC is busy.

### Demo A — search → evidence → schedule/price → handoff
Type: "Tìm sân cầu lông ở Thủ Đức tối thứ Bảy này, chơi 2 tiếng, tổng
dưới 400 nghìn. Tôi ưu tiên ánh sáng tốt."
Expected: it asks for the start time if none was given (or uses your
window), shortlists venues with Google ratings labelled, cites review
evidence about lighting (both sides if both exist), checks the demo
schedule and quotes per-hour sums labelled *giá tham chiếu*, then —
once you pick a venue + facility + start time — produces the handoff
card. Clicking it lands in the booking widget pre-filled; YOU confirm
there. Point out: the assistant never created a booking (check
My Bookings before/after).

### Demo B — conflicting evidence
Ask about a shortlisted venue: "Có chắc sân này không bị chói không?"
Expected: both pro and con quotes with citation chips; no absolute
guarantee. Clicking a citation opens the venue page anchor.

### Demo C — missing data honesty
Ask: "Vệ sinh sân này tốt hơn tháng trước chưa?"
Expected: it explains the stored Google reviews carry only relative
time labels, so a month-over-month claim is not supportable, and
offers the in-sample summary instead.

### Demo D — tool failure honesty
Simulate by asking about a venue/time you know is invalid (or stop
the dev database): the answer keeps whatever was verified (venue,
reviews) and states the schedule could not be checked — it never
says "hết sân" on an error.

## Troubleshooting

- "Trợ lý AI chưa được cấu hình model" / "AWS credentials not
  available" → AWS keys missing/invalid in the server env (or the IAM
  user lacks Bedrock access for Claude Haiku 4.5); restart the dev
  server after editing `.env`.
- Answers fall back to "limited" often → the model is not following
  the JSON protocol; try a stronger model id (`AI_MODEL`) and check
  the returned `trace.validation` in the API response.
- 429s → the assistant has its own limiter (20 turns/10 min per user
  or IP); wait or raise it in `src/lib/rate-limit.ts`.
- Turn it off instantly: `AI_ASSISTANT_ENABLED=false` + restart /
  redeploy. Everything else on the site keeps working.
