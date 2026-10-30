/**
 * AI assistant benchmark runner.
 *
 * Executes eval/ai/cases.json against a throwaway fixture database
 * with a SCRIPTED model (the script in each case plays the model's
 * part of the protocol). This measures the parts that must be exact —
 * tool behaviour, protocol validation, budget enforcement, answer
 * hydration, no-write guarantees — under a fixed data snapshot. It
 * does NOT measure a real LLM's planning quality; that requires a
 * configured provider and is reported as a separate gate.
 *
 * Usage: npx tsx eval/ai/run-benchmark.ts
 * Outputs: eval/ai/report.json + eval/ai/report.md, exit code 1 when
 * any case fails or the global no-write invariant is violated.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createAiFixtureDb, SAT, FRI } from "../../tests/ai/fixtures";
import { runAssistantTurn, __resetConversations, type AssistantTurnResult } from "@/lib/ai/orchestrator";
import { ScriptedModel, type ModelMessage } from "@/lib/ai/provider";
import { loadAiConfig, type AiConfig } from "@/lib/ai/config";

interface CaseExpect {
  answerTypeIn?: string[];
  venueIdsInclude?: string[];
  evidenceIdsInclude?: string[];
  optionTotalsInclude?: number[];
  messageMustNotMatch?: string[];
  toolsUsedInclude?: string[];
  toolsUsedExclude?: string[];
}
interface BenchCase {
  id: string;
  split: "dev" | "holdout";
  category: string;
  turns: { user: string; script: Record<string, unknown>[] }[];
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

const cfg: AiConfig = {
  ...loadAiConfig({ AI_ASSISTANT_ENABLED: "true", AI_API_KEY: "benchmark" } as unknown as NodeJS.ProcessEnv),
  maxToolExecutions: 12,
  maxEvidenceRounds: 1,
  maxModelRounds: 8,
  toolTimeoutMs: 10_000,
  requestTimeoutMs: 60_000,
};

async function runCase(benchCase: BenchCase, db: Parameters<typeof runAssistantTurn>[0]["db"]): Promise<{ pass: boolean; failures: string[]; result: AssistantTurnResult; toolsUsed: string[] }> {
  __resetConversations();
  const queue = benchCase.turns.flatMap((t) => t.script);
  let cursor = 0;
  const model = new ScriptedModel((messages: ModelMessage[]) => {
    const step = queue[cursor++] as Record<string, unknown> | undefined;
    if (!step) {
      return JSON.stringify({ kind: "final", answer: { type: "clarification", message: "Bạn cần gì thêm?", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] } });
    }
    if ("finalFromHandoff" in step) {
      const toolMsg = [...messages].reverse().find((m) => m.role === "tool");
      const env = toolMsg ? (JSON.parse(toolMsg.content) as { data?: { handoffId?: string } }) : {};
      return JSON.stringify({
        kind: "final",
        answer: { type: "booking_handoff", message: "Đã chuẩn bị xong — bạn xác nhận trong trang đặt sân.", venueIds: [], evidenceIds: [], optionIds: [], handoffId: env.data?.handoffId ?? null, missingFields: [] },
      });
    }
    if ("tool" in step) return JSON.stringify({ kind: "tool_call", tool: step.tool, input: step.input ?? {} });
    return JSON.stringify({ kind: "final", answer: step.final });
  });

  let conversationId: string | undefined;
  let last: AssistantTurnResult | null = null;
  const toolsUsed: string[] = [];
  for (const turn of benchCase.turns) {
    last = await runAssistantTurn({ conversationId, userMessage: turn.user, model, db, cfg });
    conversationId = last.conversationId;
    toolsUsed.push(...last.trace.toolCalls.map((c) => c.tool));
  }
  const result = last!;
  const failures: string[] = [];
  const exp = benchCase.expect;
  const answer = result.answer;
  if (exp.answerTypeIn && !exp.answerTypeIn.includes(answer.type)) failures.push(`answer.type=${answer.type} not in ${exp.answerTypeIn.join("|")}`);
  for (const id of exp.venueIdsInclude ?? []) if (!answer.venues.some((v) => v.venueId === id)) failures.push(`venues missing ${id}`);
  for (const id of exp.evidenceIdsInclude ?? []) if (!answer.evidence.some((e) => e.evidenceId === id)) failures.push(`evidence missing ${id}`);
  for (const total of exp.optionTotalsInclude ?? []) if (!answer.options.some((o) => o.totalPrice === total)) failures.push(`no option with total ${total}`);
  for (const pattern of exp.messageMustNotMatch ?? []) if (new RegExp(pattern, "i").test(answer.message)) failures.push(`message matches forbidden /${pattern}/`);
  for (const t of exp.toolsUsedInclude ?? []) if (!toolsUsed.includes(t)) failures.push(`tool ${t} not used`);
  for (const t of exp.toolsUsedExclude ?? []) if (toolsUsed.includes(t)) failures.push(`tool ${t} must not be used`);
  return { pass: failures.length === 0, failures, result, toolsUsed };
}

async function main() {
  const raw = JSON.parse(readFileSync(path.join(__dirname, "cases.json"), "utf8")) as { cases: BenchCase[] };
  const cases = substitute(raw.cases) as BenchCase[];
  const fixture = await createAiFixtureDb();
  const db = fixture.db;
  const bookingsBefore = await db.booking.count();
  const paymentsBefore = await db.payment.count();

  const results: { id: string; split: string; category: string; pass: boolean; failures: string[]; latencyMs: number }[] = [];
  for (const c of cases) {
    const started = Date.now();
    const r = await runCase(c, db as never);
    results.push({ id: c.id, split: c.split, category: c.category, pass: r.pass, failures: r.failures, latencyMs: Date.now() - started });
    console.log(`${r.pass ? "PASS" : "FAIL"} ${c.id} [${c.split}/${c.category}]${r.failures.length ? " — " + r.failures.join("; ") : ""}`);
  }

  // Stability: re-run every 5th case and require the same verdict.
  const stabilitySample = cases.filter((_, i) => i % 5 === 0);
  let stabilityAgree = 0;
  for (const c of stabilitySample) {
    const r = await runCase(c, db as never);
    const first = results.find((x) => x.id === c.id)!;
    if (r.pass === first.pass) stabilityAgree += 1;
  }

  const bookingsAfter = await db.booking.count();
  const paymentsAfter = await db.payment.count();
  const noWrite = bookingsBefore === bookingsAfter && paymentsBefore === paymentsAfter;

  const bySplit = (split: string) => {
    const rows = results.filter((r) => r.split === split);
    return { total: rows.length, passed: rows.filter((r) => r.pass).length };
  };
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
  const summary = {
    ranAt: new Date().toISOString(),
    model: "scripted (protocol replay) — measures tools/orchestration, NOT real-LLM quality",
    fixture: "tests/ai/fixtures.ts (PostgreSQL isolated test schema)",
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    dev: bySplit("dev"),
    holdout: bySplit("holdout"),
    stability: { sample: stabilitySample.length, agreed: stabilityAgree },
    noWriteInvariant: noWrite,
    latencyMs: { p50: latencies[Math.floor(latencies.length / 2)], p95 },
    results,
  };
  writeFileSync(path.join(__dirname, "report.json"), JSON.stringify(summary, null, 2) + "\n");
  const md = [
    "# AI assistant benchmark — run report",
    "",
    `Run at: ${summary.ranAt}`,
    `Model: ${summary.model}`,
    `Fixture: ${summary.fixture}`,
    "",
    `- Total: ${summary.passed}/${summary.total} passed`,
    `- Dev split: ${summary.dev.passed}/${summary.dev.total}`,
    `- Holdout split: ${summary.holdout.passed}/${summary.holdout.total}`,
    `- Stability (re-run agreement): ${stabilityAgree}/${stabilitySample.length}`,
    `- No-write invariant (bookings/payments unchanged): ${noWrite ? "HELD" : "VIOLATED"}`,
    `- Orchestration latency p50 ${summary.latencyMs.p50}ms / p95 ${p95}ms (local, scripted model, fixture DB — NOT production latency)`,
    "",
    "| Case | Split | Category | Result |",
    "|---|---|---|---|",
    ...results.map((r) => `| ${r.id} | ${r.split} | ${r.category} | ${r.pass ? "PASS" : "FAIL: " + r.failures.join("; ")} |`),
    "",
  ].join("\n");
  writeFileSync(path.join(__dirname, "report.md"), md);
  console.log(`\n${summary.passed}/${summary.total} passed · dev ${summary.dev.passed}/${summary.dev.total} · holdout ${summary.holdout.passed}/${summary.holdout.total} · no-write ${noWrite ? "HELD" : "VIOLATED"} · stability ${stabilityAgree}/${stabilitySample.length}`);
  await fixture.cleanup();
  if (summary.passed !== summary.total || !noWrite) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
