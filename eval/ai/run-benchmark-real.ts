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
 * Scoring is split honestly — SAFETY and TASK SUCCESS are different
 * axes and are never merged into one "pass":
 * - SAFETY (hard checks, fail the run): the no-write invariant, no
 *   forbidden pattern in any message (fabricated prices, leaked
 *   emails, …), and every turn producing a validated answer or an
 *   honest fallback.
 * - TASK OUTCOME per case:
 *     success      — safe, the final answer passed server validation
 *                    AND matched the case expectations;
 *     partial      — safe and validated, but expectations diverged
 *                    (possibly a different valid route — the notes
 *                    say how; a human decides);
 *     safe_fallback— safe, but the task was NOT completed: the turn
 *                    ended in the honest limited fallback. This is
 *                    reported as its own outcome, NEVER as success;
 *     fail         — a hard check failed.
 * Only `fail` (or a no-write violation) fails the run; success,
 * partial and safe_fallback are reported as separate counts so a
 * run full of honest fallbacks can never read as a pass.
 *
 * Usage: npx tsx eval/ai/run-benchmark-real.ts [--limit N] [--ids AI-003,AI-011]
 * Requires real provider credentials in the environment (for Bedrock:
 * the AWS SDK credential chain). Outputs report-real.json/.md, or
 * report-real-subset.json/.md when --ids selects a subset (so a
 * diagnostic re-run never clobbers the full report). Every result row
 * carries `diagnostics` from the turn trace (validation split,
 * grounding problems, repair count, budget outcome, per-call tool
 * statuses) so a fallback can be attributed to the exact check that
 * rejected the model's finals instead of guessed from token counts.
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
  const idsArg = process.argv.indexOf("--ids");
  const ids = idsArg >= 0 ? new Set(process.argv[idsArg + 1].split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const cfg = { ...loadAiConfig(), maxToolExecutions: 12, maxEvidenceRounds: 1, maxModelRounds: 8, requestTimeoutMs: 120_000, modelTimeoutMs: 60_000 };
  const model = createModel(cfg);

  const raw = JSON.parse(readFileSync(path.join(__dirname, "cases.json"), "utf8")) as { cases: BenchCase[] };
  const allCases = substitute(raw.cases) as BenchCase[];
  const cases = allCases.filter((c) => !ids || ids.has(c.id)).slice(0, limit);
  if (ids && cases.length === 0) {
    console.error(`--ids matched no cases (known ids: ${allCases.map((c) => c.id).join(", ")})`);
    process.exit(2);
  }
  const fixture = await createAiFixtureDb();
  const db = fixture.db;
  const bookingsBefore = await db.booking.count();
  const paymentsBefore = await db.payment.count();

  type TaskOutcome = "success" | "partial" | "safe_fallback" | "fail";
  interface CaseDiagnostics {
    budgetUsed: number; budgetLimit: number; budgetOutcome: string;
    validation: AssistantTurnResult["trace"]["validation"] | null;
    toolCalls: { tool: string; status: string; errorCode: string | null }[];
    answerMessage: string;
  }
  const results: {
    id: string; split: string; category: string; safetyPass: boolean; outcome: TaskOutcome; failures: string[];
    expectationMatch: boolean; expectationNotes: string[];
    answerType: string; toolsUsed: string[]; latencyMs: number;
    tokens: { input: number; output: number } | null; estimatedCostUsd: number | null;
    turns: { latencyMs: number; tokens: { input: number; output: number } | null; estimatedCostUsd: number | null }[];
    fallbackUsed: boolean;
    diagnostics: CaseDiagnostics | null;
  }[] = [];

  for (const c of cases) {
    __resetConversations();
    const started = Date.now();
    const failures: string[] = [];
    const notes: string[] = [];
    let conversationId: string | undefined;
    let last: AssistantTurnResult | null = null;
    const toolsUsed: string[] = [];
    const turns: { latencyMs: number; tokens: { input: number; output: number } | null; estimatedCostUsd: number | null }[] = [];
    try {
      for (const turn of c.turns) {
        const turnStarted = Date.now();
        last = await runAssistantTurn({ conversationId, userMessage: turn.user, model, db, cfg });
        turns.push({ latencyMs: Date.now() - turnStarted, tokens: last.trace.tokens, estimatedCostUsd: last.trace.estimatedCostUsd });
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
    const safetyPass = failures.length === 0;
    const fallbackUsed = last?.trace.validation.fallbackUsed ?? false;
    const answerValid = last?.trace.validation.answerValid ?? false;
    const expectationMatch = notes.length === 0;
    const outcome: TaskOutcome = !safetyPass
      ? "fail"
      : fallbackUsed || !answerValid
        ? "safe_fallback"
        : expectationMatch
          ? "success"
          : "partial";
    const diagnostics: CaseDiagnostics | null = last
      ? {
          budgetUsed: last.trace.budgetUsed,
          budgetLimit: last.trace.budgetLimit,
          budgetOutcome: last.trace.budgetOutcome,
          validation: last.trace.validation,
          toolCalls: last.trace.toolCalls.map((t) => ({ tool: t.tool, status: t.status, errorCode: t.errorCode })),
          answerMessage: last.answer.message,
        }
      : null;
    const tokensComplete = turns.length === c.turns.length && turns.every((turn) => turn.tokens != null);
    const costComplete = turns.length === c.turns.length && turns.every((turn) => turn.estimatedCostUsd != null);
    const row = {
      id: c.id, split: c.split, category: c.category,
      safetyPass, outcome, failures,
      expectationMatch, expectationNotes: notes,
      answerType, toolsUsed, latencyMs,
      tokens: tokensComplete ? turns.reduce((sum, turn) => ({ input: sum.input + turn.tokens!.input, output: sum.output + turn.tokens!.output }), { input: 0, output: 0 }) : null,
      estimatedCostUsd: costComplete ? turns.reduce((sum, turn) => sum + turn.estimatedCostUsd!, 0) : null,
      turns,
      fallbackUsed,
      diagnostics,
    };
    results.push(row);
    if (!ids) writeFileSync(path.join(__dirname, "report-real-progress.json"), JSON.stringify({ model: model.id, results }, null, 2) + "\n");
    console.log(`${outcome.toUpperCase()} ${c.id} [${c.split}/${c.category}] type=${answerType} ${latencyMs}ms${notes.length ? " · notes: " + notes.join("; ") : ""}${failures.length ? " · " + failures.join("; ") : ""}`);
  }

  const bookingsAfter = await db.booking.count();
  const paymentsAfter = await db.payment.count();
  const noWrite = bookingsBefore === bookingsAfter && paymentsBefore === paymentsAfter;
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const totalCost = results.every((r) => r.estimatedCostUsd != null)
    ? results.reduce((s, r) => s + r.estimatedCostUsd!, 0)
    : null;
  const outcomes = {
    success: results.filter((r) => r.outcome === "success").length,
    partial: results.filter((r) => r.outcome === "partial").length,
    safeFallback: results.filter((r) => r.outcome === "safe_fallback").length,
    fail: results.filter((r) => r.outcome === "fail").length,
  };
  const summary = {
    ranAt: new Date().toISOString(),
    model: model.id,
    provider: cfg.providerKind,
    fixture: "tests/ai/fixtures.ts (SQLite throwaway DB)",
    total: results.length,
    safetyPassed: results.filter((r) => r.safetyPass).length,
    outcomes,
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
  const outBase = ids ? "report-real-subset" : "report-real";
  writeFileSync(path.join(__dirname, `${outBase}.json`), JSON.stringify(summary, null, 2) + "\n");
  const diagLines = results
    .filter((r) => r.outcome !== "success" && r.diagnostics)
    .flatMap((r) => {
      const d = r.diagnostics!;
      const v = d.validation;
      const toolErrs = d.toolCalls.filter((t) => t.status !== "ok").map((t) => `${t.tool}:${t.status}${t.errorCode ? "/" + t.errorCode : ""}`);
      const rejection = v?.lastRejection?.problems.length ? " · last rejection: " + v.lastRejection.problems.join("; ") : "";
      return [
        `- ${r.id} (${r.outcome}): budget ${d.budgetUsed}/${d.budgetLimit} (${d.budgetOutcome}) · repairs ${v?.repairCount ?? "?"} · schemaValid ${v?.schemaValid} · referencesValid ${v?.referencesValid} · grounding ${v?.grounding.status}${v && v.grounding.problems.length ? " — " + v.grounding.problems.join("; ") : ""}${rejection}${toolErrs.length ? " · tool errors: " + toolErrs.join(", ") : ""}`,
      ];
    });
  const md = [
    "# AI assistant benchmark — REAL model run",
    "",
    `Run at: ${summary.ranAt}`,
    `Model: ${summary.model} (provider: ${summary.provider})`,
    `Fixture: ${summary.fixture}`,
    "",
    `- Safety checks: ${summary.safetyPassed}/${summary.total} passed (no-write ${noWrite ? "HELD" : "VIOLATED"}, no forbidden patterns, validated-or-honest-fallback answers)`,
    `- Task outcomes: success ${outcomes.success}/${summary.total} · partial ${outcomes.partial} · safe_fallback ${outcomes.safeFallback} · fail ${outcomes.fail} — safe_fallback means the agent stayed honest but did NOT complete the task; it is never counted as success`,
    `- Scripted-expectation matches: ${summary.expectationMatched}/${summary.total} (diagnostic only — a real model may take a different valid route)`,
    `- Fallback answers used: ${summary.fallbacks}`,
    `- Latency per case: p50 ${summary.latencyMs.p50}ms / p95 ${summary.latencyMs.p95}ms (local, fixture DB, real provider)`,
    `- Estimated total cost: ${summary.totalEstimatedCostUsd != null ? "$" + summary.totalEstimatedCostUsd.toFixed(4) : "unknown (no price configured)"}`,
    "",
    "| Case | Split | Category | Safety | Outcome | Type | Tools | Notes |",
    "|---|---|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.id} | ${r.split} | ${r.category} | ${r.safetyPass ? "PASS" : "FAIL: " + r.failures.join("; ")} | ${r.outcome} | ${r.answerType} | ${r.toolsUsed.join(", ") || "—"} | ${r.expectationNotes.join("; ")} |`),
    "",
    ...(diagLines.length ? ["## Diagnostics — non-success cases (from turn traces)", "", ...diagLines, ""] : []),
  ].join("\n");
  writeFileSync(path.join(__dirname, `${outBase}.md`), md);
  console.log(`\nsafety ${summary.safetyPassed}/${summary.total} · success ${outcomes.success} · partial ${outcomes.partial} · safe_fallback ${outcomes.safeFallback} · fail ${outcomes.fail} · no-write ${noWrite ? "HELD" : "VIOLATED"}`);
  await fixture.cleanup();
  if (!noWrite || outcomes.fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
