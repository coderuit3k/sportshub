# AI assistant benchmark — run report

Run at: 2026-10-28T06:05:59.100Z
Model: scripted (protocol replay) — measures tools/orchestration, NOT real-LLM quality
Fixture: tests/ai/fixtures.ts (SQLite throwaway DB)

- Total: 50/50 passed
- Dev split: 34/34
- Holdout split: 16/16
- Stability (re-run agreement): 10/10
- No-write invariant (bookings/payments unchanged): HELD
- Orchestration latency p50 10ms / p95 23ms (local, scripted model, fixture DB — NOT production latency)

| Case | Split | Category | Result |
|---|---|---|---|
| AI-001 | dev | search | PASS |
| AI-002 | dev | search | PASS |
| AI-003 | dev | search | PASS |
| AI-004 | dev | search | PASS |
| AI-005 | dev | search | PASS |
| AI-006 | dev | search | PASS |
| AI-007 | dev | search | PASS |
| AI-008 | dev | search | PASS |
| AI-009 | holdout | search | PASS |
| AI-010 | holdout | search | PASS |
| AI-011 | dev | search | PASS |
| AI-012 | dev | search | PASS |
| AI-013 | holdout | search | PASS |
| AI-014 | dev | search | PASS |
| AI-015 | dev | search | PASS |
| AI-016 | holdout | search | PASS |
| AI-017 | dev | search | PASS |
| AI-018 | dev | search | PASS |
| AI-019 | holdout | search | PASS |
| AI-020 | dev | search | PASS |
| AI-021 | dev | review | PASS |
| AI-022 | dev | review | PASS |
| AI-023 | dev | review | PASS |
| AI-024 | dev | review | PASS |
| AI-025 | dev | review | PASS |
| AI-026 | dev | review | PASS |
| AI-027 | holdout | review | PASS |
| AI-028 | holdout | review | PASS |
| AI-029 | holdout | review | PASS |
| AI-030 | holdout | review | PASS |
| AI-031 | dev | schedule | PASS |
| AI-032 | dev | schedule | PASS |
| AI-033 | dev | schedule | PASS |
| AI-034 | dev | schedule | PASS |
| AI-035 | dev | schedule | PASS |
| AI-036 | holdout | schedule | PASS |
| AI-037 | holdout | schedule | PASS |
| AI-038 | holdout | schedule | PASS |
| AI-039 | dev | schedule | PASS |
| AI-040 | dev | schedule | PASS |
| AI-041 | dev | edge | PASS |
| AI-042 | dev | edge | PASS |
| AI-043 | dev | edge | PASS |
| AI-044 | dev | edge | PASS |
| AI-045 | dev | edge | PASS |
| AI-046 | holdout | edge | PASS |
| AI-047 | holdout | edge | PASS |
| AI-048 | holdout | edge | PASS |
| AI-049 | holdout | edge | PASS |
| AI-050 | dev | edge | PASS |
