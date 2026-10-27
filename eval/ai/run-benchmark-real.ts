/**
 * AI assistant benchmark — REAL model runner.
 *
 * Same cases and fixture DB as run-benchmark.ts, but the model is the
 * configured production provider (default: Amazon Bedrock, Claude
 * Haiku 4.5) instead of a scripted replay. The case scripts are
 * ignored; only the user turns are sent. This measures what the
 * scripted benchmark cannot: the real model's planning (which tools
 * it calls, in which order), clarification behaviour, protocol
 * compliance (answers that pass server validation without the
 * fallback), latency, token usage and cost.
 *
 * Scoring is split honestly:
 * - HARD checks (fail the run): the no-write invariant, no forbidden
 *   pattern in any message (fabricated prices, leaked emails, …), and
 *   every turn producing a validated answer or an honest fallback.
 * - EXPECTATION matches (reported, not gated): answer type in the
 *   case's expected set and scripted tool-usage expectations. A real
 *   model may reach a correct answer by a different valid route, so
 *   these are diagnostics for prompt work, not pass/fail.
 *
 * Usage: npx tsx eval/ai/run-benchmark-real.ts [--limit N]
 * Requires real provider credentials in the environment (for Bedrock:
 * the AWS SDK credential chain). Outputs report-real.json/.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAiFixtureDb, SAT, FRI } from "../../tests/ai/fixtures";
import { runAssistantTurn, __resetConversations, type AssistantTurnResult } from "@/lib/ai/orchestrator";
import { createModel } from "@/lib/ai/provider";
import { loadAiConfig } from "@/lib/ai/config";

interface CaseExpect {
  answerTypeIn?: string[];
  messageMustNotMatch?: string[];
  toolsUsedInclude?: string[];
  toolsUsedExclude?: string[];
}
interface BenchCase {
  id: string;
  split: "dev" | "holdout";
  category: string;
  turns: { user: string }[];
  expect: CaseExpect;
}

function substitute(value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll("{{SAT}}", SAT).replaceAll("{{FRI}}", FRI);
  if (Array.isArray(value)) return value.map(substitute);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v)]));
  }
  return value;
}

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  const cfg = { ...loadAiConfig(), maxToolExecutions: 12, maxEvidenceRounds: 1, maxModelRounds: 8, requestTimeoutMs: 120_000, modelTimeoutMs: 60_000 };
  const model = createModel(cfg);

  const raw = JSON.parse(readFileSync(path.join(__dirname, "cases.json"), "utf8")) as { cases: BenchCase[] };
  const cases = (substitute(raw.cases) as BenchCase[]).slice(0, limit);
  const fixture = await createAiFixtureDb();
  const db = fixture.db;
  const bookingsBefore = await db.booking.count();
  const paymentsBefore = await db.payment.count();

  const results: {
    id: string; split: string; category: string; hardPass: boolean; failures: string[];
    expectationMatch: boolean; expectationNotes: string[];
    answerType: string; toolsUsed: string[]; latencyMs: number;
    tokens: { input: number; output: number } | null; estimatedCostUsd: number | null;
    fallbackUsed: boolean;
  }[] = [];

  for (const c of cases) {
    __resetConversations();
    const started = Date.now();
    const failures: string[] = [];
    const notes: string[] = [];
    let conversationId: string | undefined;
    let last: AssistantTurnResult | null = null;
    const toolsUsed: string[] = [];
    try {
      for (const turn of c.turns) {
        last = await runAssistantTurn({ conversationId, userMessage: turn.user, model, db, cfg });
        conversationId = last.conversationId;
        toolsUsed.push(...last.trace.toolCalls.map((t) => t.tool));
        for (const pattern of c.expect.messageMustNotMatch ?? []) {
          if (new RegExp(pattern, "i").test(last.answer.message)) failures.push(`message matches forbidden /${pattern}/`);
        }
      }
    } catch (e) {
      failures.push(`turn threw: ${e instanceof Error ? e.message : String(e)}`);
    }
    const latencyMs = Date.now() - started;
    const answerType = last?.answer.type ?? "none";
    if (last && !last.trace.validation.answerValid && !last.trace.validation.fallbackUsed) {
      failures.push("final turn neither validated nor an honest fallback");
    }
    const exp = c.expect;
    if (exp.answerTypeIn && !exp.answerTypeIn.includes(answerType)) notes.push(`answer.type=${answerType} not in ${exp.answerTypeIn.join("|")}`);
    for (const t of exp.toolsUsedInclude ?? []) if (!toolsUsed.includes(t)) notes.push(`tool ${t} not used`);
    for (const t of exp.toolsUsedExclude ?? []) if (toolsUsed.includes(t)) notes.push(`tool ${t} used but scripted case excludes it`);
    const row = {
      id: c.id, split: c.split, category: c.category,
      hardPass: failures.length === 0, failures,
      expectationMatch: notes.length === 0, expectationNotes: notes,
      answerType, toolsUsed, latencyMs,
      tokens: last?.trace.tokens ?? null,
      estimatedCostUsd: last?.trace.estimatedCostUsd ?? null,
      fallbackUsed: last?.trace.validation.fallbackUsed ?? false,
    };
    results.push(row);
    console.log(`${row.hardPass ? "PASS" : "FAIL"} ${c.id} [${c.split}/${c.category}] type=${answerType} ${latencyMs}ms${notes.length ? " · notes: " + notes.join("; ") : ""}${failures.length ? " · " + failures.join("; ") : ""}`);
  }

  const bookingsAfter = await db.booking.count();
  const paymentsAfter = await db.payment.count();
  const noWrite = bookingsBefore === bookingsAfter && paymentsBefore === paymentsAfter;
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const totalCost = results.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0);
  const summary = {
    ranAt: new Date().toISOString(),
    model: model.id,
    provider: cfg.providerKind,
    fixture: "tests/ai/fixtures.ts (SQLite throwaway DB)",
    total: results.length,
    hardPassed: results.filter((r) => r.hardPass).length,
    expectationMatched: results.filter((r) => r.expectationMatch).length,
    fallbacks: results.filter((r) => r.fallbackUsed).length,
    noWriteInvariant: noWrite,
    latencyMs: {
      p50: latencies[Math.floor(latencies.length / 2)] ?? 0,
      p95: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? 0,
    },
    totalEstimatedCostUsd: cfg.pricePerMillion ? totalCost : null,
    results,
  };
  writeFileSync(path.join(__dirname, "report-real.json"), JSON.stringify(summary, null, 2) + "\n");
  const md = [
    "# AI assistant benchmark — REAL model run",
    "",
    `Run at: ${summary.ranAt}`,
    `Model: ${summary.model} (provider: ${summary.provider})`,
    `Fixture: ${summary.fixture}`,
    "",
    `- Hard checks: ${summary.hardPassed}/${summary.total} passed (no-write ${noWrite ? "HELD" : "VIOLATED"}, no forbidden patterns, validated-or-honest-fallback answers)`,
    `- Scripted-expectation matches: ${summary.expectationMatched}/${summary.total} (diagnostic only — a real model may take a different valid route)`,
    `- Fallback answers used: ${summary.fallbacks}`,
    `- Latency per case: p50 ${summary.latencyMs.p50}ms / p95 ${summary.latencyMs.p95}ms (local, fixture DB, real provider)`,
    `- Estimated total cost: ${summary.totalEstimatedCostUsd != null ? "$" + summary.totalEstimatedCostUsd.toFixed(4) : "unknown (no price configured)"}`,
    "",
    "| Case | Split | Category | Hard | Type | Tools | Notes |",
    "|---|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.id} | ${r.split} | ${r.category} | ${r.hardPass ? "PASS" : "FAIL: " + r.failures.join("; ")} | ${r.answerType} | ${r.toolsUsed.join(", ") || "—"} | ${r.expectationNotes.join("; ")} |`),
    "",
  ].join("\n");
  writeFileSync(path.join(__dirname, "report-real.md"), md);
  console.log(`\n${summary.hardPassed}/${summary.total} hard-pass · expectation ${summary.expectationMatched}/${summary.total} · no-write ${noWrite ? "HELD" : "VIOLATED"}`);
  await fixture.cleanup();
  if (!noWrite || summary.hardPassed !== summary.total) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
