/**
 * Assistant orchestrator: one agent, typed tools, bounded everything.
 *
 * Flow per user message:
 *   validate → load/create conversation state → model turn(s) over a
 *   strict JSON protocol → typed tool execution under a shared budget
 *   (composite sub-calls included) and per-tool timeouts → at most one
 *   supplementary evidence round → final answer VALIDATED against the
 *   evidence/venue/option/handoff registries built from real tool
 *   results → hydrated structured answer + trace.
 *
 * The model never supplies display numbers directly: it references
 * server-issued ids, and the server hydrates cards/options/evidence
 * from tool results. A hallucinated id fails validation; after one
 * repair round the server falls back to a limited answer built from
 * verified data instead of emitting the invalid answer.
 *
 * Conversation state lives server-side per instance AND round-trips
 * through the client (appliedContext + history summaries), so a turn
 * landing on a fresh serverless instance rehydrates from the
 * client-carried context instead of forgetting the conversation. The
 * tool-result registry is per-instance only: after an instance
 * switch the model simply re-runs the read-only tools it needs. The
 * context holds only public search context — never user records. A
 * conversation id alone grants access to that context only; tools
 * re-check venue visibility on every call.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { BudgetCounter, ToolErrorCode, type ToolEnvelope } from "./types";
import { TOOLS } from "./tools";
import type { ChatModel, ModelMessage } from "./provider";
import { ProviderError } from "./provider";
import { buildSystemPrompt, PROMPT_VERSION, ANSWER_SCHEMA_VERSION } from "./prompts";
import { loadAiConfig, type AiConfig } from "./config";
import { BUSINESS_TZ, fromWallTime, todayDateISO } from "@/lib/time/tz";
import type { VenueCardData } from "./tools/shared";
import type { EvidenceItem } from "./tools/review-evidence";
import type { BookableOption } from "./tools/bookable-options";
import type { VenueComparison } from "./tools/compare";
import type { BookingHandoff } from "./tools/handoff";

/* ------------------------- conversation state ------------------------ */

export const ConversationState = z.object({
  sportSlug: z.string().max(60).nullable().default(null),
  district: z.string().max(80).nullable().default(null),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  durationHours: z.number().int().min(1).max(6).nullable().default(null),
  budgetAmount: z.number().int().positive().nullable().default(null),
  budgetBasis: z.enum(["per_hour", "total_session"]).nullable().default(null),
  venueIds: z.array(z.string().max(80)).max(5).default([]),
  criteria: z.array(z.string().max(80)).max(8).default([]),
});
export type ConversationState = z.infer<typeof ConversationState>;

const StatePatch = ConversationState.partial().extend({
  venueIds: z.array(z.string().max(80)).max(5).optional(),
  criteria: z.array(z.string().max(80)).max(8).optional(),
});

interface RuntimeRegistry {
  venues: Map<string, VenueCardData>;
  evidence: Map<string, EvidenceItem>;
  options: Map<string, BookableOption>;
  handoffs: Map<string, BookingHandoff>;
  comparison: VenueComparison | null;
  warnings: string[];
}

interface Conversation {
  id: string;
  state: ConversationState;
  history: { role: "user" | "assistant"; content: string }[];
  registry: RuntimeRegistry;
  updatedAt: number;
}

const conversations = new Map<string, Conversation>();
const CONVERSATION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_CONVERSATIONS = 500;

/**
 * Conversation context the CLIENT carries between turns and returns
 * with each request. Server instances are ephemeral (serverless), so
 * the in-process map is only a cache: when an instance does not know
 * the conversation, it rehydrates state + history from this payload.
 * The payload is public search context only (sport/district/date/…),
 * re-validated with the ConversationState schema — never user
 * records — and every tool re-checks visibility anyway, so a forged
 * payload can only distort the caller's own search context.
 */
export interface ClientConversationContext {
  state?: unknown;
  history?: { role: "user" | "assistant"; content: string }[];
}

function getOrCreateConversation(
  id: string | undefined,
  clientContext?: ClientConversationContext,
): Conversation {
  const nowMs = Date.now();
  for (const [key, c] of conversations) {
    if (nowMs - c.updatedAt > CONVERSATION_TTL_MS) conversations.delete(key);
  }
  if (id && conversations.has(id)) {
    const c = conversations.get(id)!;
    c.updatedAt = nowMs;
    return c;
  }
  if (conversations.size >= MAX_CONVERSATIONS) {
    const oldest = [...conversations.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (oldest) conversations.delete(oldest.id);
  }
  const parsedState = clientContext?.state
    ? ConversationState.safeParse(clientContext.state)
    : null;
  const history = (clientContext?.history ?? [])
    .filter(
      (h): h is { role: "user" | "assistant"; content: string } =>
        !!h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string",
    )
    .slice(-24)
    .map((h) => ({ role: h.role, content: h.content.slice(0, 2000) }));
  const c: Conversation = {
    // A client-carried conversation keeps its id across instances;
    // without client context an unknown id still starts fully fresh.
    id: clientContext && id ? id : randomUUID(),
    state: parsedState?.success ? parsedState.data : ConversationState.parse({}),
    history,
    registry: { venues: new Map(), evidence: new Map(), options: new Map(), handoffs: new Map(), comparison: null, warnings: [] },
    updatedAt: nowMs,
  };
  conversations.set(c.id, c);
  return c;
}

/* --------------------------- model protocol -------------------------- */

const ModelReply = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tool_call"),
    tool: z.string().min(1),
    input: z.record(z.unknown()).default({}),
    statePatch: StatePatch.optional(),
  }),
  z.object({
    kind: z.literal("final"),
    statePatch: StatePatch.optional(),
    answer: z.object({
      type: z.enum([
        "clarification",
        "venue_shortlist",
        "venue_comparison",
        "review_insight",
        "booking_handoff",
        "limited_answer",
      ]),
      message: z.string().min(1).max(6000),
      venueIds: z.array(z.string().max(80)).max(5).default([]),
      evidenceIds: z.array(z.string().max(120)).max(12).default([]),
      optionIds: z.array(z.string().max(120)).max(12).default([]),
      handoffId: z.string().max(80).nullable().default(null),
      missingFields: z.array(z.string().max(40)).max(8).default([]),
    }),
  }),
]);

export interface AssistantAnswer {
  type:
    | "clarification"
    | "venue_shortlist"
    | "venue_comparison"
    | "review_insight"
    | "booking_handoff"
    | "limited_answer"
    | "error";
  message: string;
  venues: VenueCardData[];
  comparison: VenueComparison | null;
  evidence: EvidenceItem[];
  options: BookableOption[];
  handoff: BookingHandoff | null;
  warnings: string[];
  missingFields: string[];
  appliedContext: ConversationState;
}

export interface AssistantTrace {
  traceId: string;
  modelId: string;
  promptVersion: string;
  answerSchemaVersion: string;
  startedAt: string;
  latencyMs: number;
  toolCalls: { tool: string; status: string; durationMs: number; errorCode: string | null; input: Record<string, unknown> }[];
  budgetUsed: number;
  budgetLimit: number;
  budgetOutcome: "ok" | "exhausted" | "request_timeout";
  evidenceRoundsUsed: number;
  validation: { answerValid: boolean; repaired: boolean; fallbackUsed: boolean };
  tokens: { input: number; output: number } | null;
  estimatedCostUsd: number | null;
}

export interface AssistantTurnResult {
  conversationId: string;
  answer: AssistantAnswer;
  trace: AssistantTrace;
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("NO_JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

function applyStatePatch(state: ConversationState, patch: z.infer<typeof StatePatch> | undefined): ConversationState {
  if (!patch) return state;
  const next = { ...state };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  }
  const parsedState = ConversationState.safeParse(next);
  return parsedState.success ? parsedState.data : state;
}

/** Register a tool result's payload into the conversation registry. */
function registerToolResult(conv: Conversation, tool: string, env: ToolEnvelope<unknown>): void {
  if (env.status === "error" || env.data == null) return;
  const data = env.data as Record<string, unknown>;
  conv.registry.warnings.push(...env.warnings);
  if (tool === "search_venues") {
    for (const v of (data.venues as VenueCardData[]) ?? []) conv.registry.venues.set(v.venueId, v);
  }
  if (tool === "search_review_evidence") {
    for (const item of (data.items as EvidenceItem[]) ?? []) conv.registry.evidence.set(item.evidenceId, item);
  }
  if (tool === "get_bookable_options") {
    for (const o of (data.options as BookableOption[]) ?? []) conv.registry.options.set(o.optionId, o);
  }
  if (tool === "compare_venue_options") {
    const comp = data as unknown as VenueComparison;
    conv.registry.comparison = comp;
    for (const pv of comp.perVenue) {
      if (pv.bestOption) conv.registry.options.set(pv.bestOption.optionId, pv.bestOption);
    }
  }
  if (tool === "prepare_booking_handoff") {
    const h = data as unknown as BookingHandoff;
    conv.registry.handoffs.set(h.handoffId, h);
  }
}

function validateAndHydrate(
  conv: Conversation,
  draft: Extract<z.infer<typeof ModelReply>, { kind: "final" }>["answer"],
): { ok: true; answer: AssistantAnswer } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  // For a comparison answer, venueIds reference the comparison result
  // itself (validated separately below) — the comparison tool does not
  // mint venue cards, so the card-registry check does not apply.
  if (draft.type !== "venue_comparison") {
    for (const id of draft.venueIds) if (!conv.registry.venues.has(id)) problems.push(`unknown venueId ${id}`);
  }
  for (const id of draft.evidenceIds) if (!conv.registry.evidence.has(id)) problems.push(`unknown evidenceId ${id}`);
  for (const id of draft.optionIds) if (!conv.registry.options.has(id)) problems.push(`unknown optionId ${id}`);
  if (draft.handoffId && !conv.registry.handoffs.has(draft.handoffId)) problems.push(`unknown handoffId ${draft.handoffId}`);
  if (draft.type === "booking_handoff" && !draft.handoffId) problems.push("booking_handoff without handoffId");
  if (draft.type === "venue_comparison") {
    const comp = conv.registry.comparison;
    if (!comp) problems.push("venue_comparison without a compare tool result");
    else if (draft.venueIds.length > 0 && [...draft.venueIds].sort().join() !== [...comp.venueIds].sort().join()) {
      problems.push("venue_comparison venueIds do not match the comparison result");
    }
  }
  for (const m of draft.message.matchAll(/\[ev:([^\]]+)\]/g)) {
    if (!conv.registry.evidence.has(m[1])) problems.push(`message cites unknown evidence ${m[1]}`);
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    answer: {
      type: draft.type,
      message: draft.message.replace(/\[ev:([^\]]+)\]/g, "").replace(/\s{2,}/g, " ").trim(),
      venues: draft.venueIds.map((id) => conv.registry.venues.get(id)!).filter(Boolean),
      comparison: draft.type === "venue_comparison" ? conv.registry.comparison : null,
      evidence: draft.evidenceIds.map((id) => conv.registry.evidence.get(id)!).filter(Boolean),
      options: draft.optionIds.map((id) => conv.registry.options.get(id)!).filter(Boolean),
      handoff: draft.handoffId ? (conv.registry.handoffs.get(draft.handoffId) ?? null) : null,
      warnings: [...new Set(conv.registry.warnings)],
      missingFields: draft.missingFields,
      appliedContext: conv.state,
    },
  };
}

function fallbackAnswer(conv: Conversation, reason: string): AssistantAnswer {
  const venues = [...conv.registry.venues.values()].slice(0, 5);
  const evidence = [...conv.registry.evidence.values()].slice(0, 4);
  const options = [...conv.registry.options.values()].slice(0, 6);
  return {
    type: "limited_answer",
    message:
      venues.length > 0
        ? `Tôi chưa hoàn thiện được câu trả lời đầy đủ (${reason}), nhưng đây là thông tin đã kiểm chứng được từ hệ thống — bạn xem các sân và bằng chứng bên dưới, hoặc thử hỏi lại cụ thể hơn.`
        : `Tôi chưa trả lời được câu này (${reason}). Bạn có thể cho biết môn thể thao, khu vực và thời gian muốn chơi để tôi tìm chính xác hơn.`,
    venues,
    comparison: null,
    evidence,
    options,
    handoff: null,
    warnings: [...new Set(conv.registry.warnings)],
    missingFields: [],
    appliedContext: conv.state,
  };
}

/** The next 14 Saigon calendar days with Vietnamese weekday names.
 * Models reliably miscompute relative weekdays ("thứ Bảy này" off by
 * one was observed live twice), so the conversion is given as a
 * lookup table in the context message instead of left to arithmetic. */
function upcomingDaysTable(now: Date): string {
  const parts: string[] = [];
  for (let i = 0; i < 14; i++) {
    const probe = new Date(now.getTime() + i * 86_400_000);
    const iso = probe.toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });
    const [y, m, d] = iso.split("-").map(Number);
    const weekday = new Intl.DateTimeFormat("vi-VN", {
      weekday: "long",
      timeZone: BUSINESS_TZ,
    }).format(fromWallTime(y, m, d, 12, 0, 0));
    parts.push(`${iso} (${weekday})`);
  }
  return parts.join(", ");
}

/* ------------------------------ the turn ----------------------------- */

export interface RunTurnArgs {
  conversationId?: string;
  userMessage: string;
  model: ChatModel;
  db: PrismaClient;
  now?: Date;
  cfg?: AiConfig;
  /** Client-carried context for rehydrating the conversation on an
   * instance that has never seen it (see ClientConversationContext). */
  clientContext?: ClientConversationContext;
}

export async function runAssistantTurn(args: RunTurnArgs): Promise<AssistantTurnResult> {
  const cfg = args.cfg ?? loadAiConfig();
  const now = args.now ?? new Date();
  const startedAtMs = Date.now();
  const traceId = randomUUID();
  const conv = getOrCreateConversation(args.conversationId, args.clientContext);
  const budget = new BudgetCounter(cfg.maxToolExecutions);
  const toolCtxBase = { db: args.db, now, timeoutMs: cfg.toolTimeoutMs };

  const trace: AssistantTrace = {
    traceId,
    modelId: args.model.id,
    promptVersion: PROMPT_VERSION,
    answerSchemaVersion: ANSWER_SCHEMA_VERSION,
    startedAt: now.toISOString(),
    latencyMs: 0,
    toolCalls: [],
    budgetUsed: 0,
    budgetLimit: cfg.maxToolExecutions,
    budgetOutcome: "ok",
    evidenceRoundsUsed: 0,
    validation: { answerValid: false, repaired: false, fallbackUsed: false },
    tokens: null,
    estimatedCostUsd: null,
  };

  const finish = (answer: AssistantAnswer): AssistantTurnResult => {
    trace.latencyMs = Date.now() - startedAtMs;
    trace.budgetUsed = budget.usedCount;
    conv.history.push({ role: "user", content: args.userMessage.slice(0, 2000) });
    conv.history.push({ role: "assistant", content: `[${answer.type}] ${answer.message}`.slice(0, 2000) });
    if (conv.history.length > 24) conv.history = conv.history.slice(-24);
    return { conversationId: conv.id, answer, trace };
  };

  const messages: ModelMessage[] = [
    { role: "system", content: buildSystemPrompt(now) },
    {
      role: "system",
      content: `Ngữ cảnh hội thoại hiện tại (state): ${JSON.stringify(conv.state)}. Hôm nay: ${todayDateISO(now)}. Bảng tra ngày (14 ngày tới, giờ ${BUSINESS_TZ}): ${upcomingDaysTable(now)}. Khi đổi ngày tương đối ("thứ Bảy này", "tối mai", "tuần sau"), TRA BẢNG này để lấy ngày YYYY-MM-DD, đừng tự tính.`,
    },
    ...conv.history.map((h) => ({ role: h.role, content: h.content }) as ModelMessage),
    { role: "user", content: args.userMessage },
  ];

  let tokensIn = 0;
  let tokensOut = 0;
  let evidenceExecutions = 0;
  let repaired = false;
  const deadline = startedAtMs + cfg.requestTimeoutMs;
  // Snapshot of registry options from EARLIER turns: the shortlist
  // auto-fill below may only use options produced by THIS turn's
  // compare/bookable calls, never stale slots from a previous turn.
  const optionsBeforeTurn = new Set(conv.registry.options.keys());

  for (let round = 0; round < cfg.maxModelRounds; round++) {
    if (Date.now() > deadline) {
      trace.budgetOutcome = "request_timeout";
      trace.validation.fallbackUsed = true;
      return finish(fallbackAnswer(conv, "hết thời gian xử lý"));
    }
    let completion;
    try {
      completion = await args.model.complete(messages, { timeoutMs: cfg.modelTimeoutMs });
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : "network";
      trace.validation.fallbackUsed = true;
      const answer = fallbackAnswer(conv, kind === "timeout" ? "mô hình phản hồi quá lâu" : "mô hình tạm thời không khả dụng");
      return finish(answer);
    }
    if (completion.usage) {
      tokensIn += completion.usage.inputTokens;
      tokensOut += completion.usage.outputTokens;
    }
    messages.push({ role: "assistant", content: completion.text });

    let reply: z.infer<typeof ModelReply>;
    try {
      reply = ModelReply.parse(extractJsonObject(completion.text));
    } catch {
      messages.push({
        role: "user",
        content: "Phản hồi của bạn không đúng định dạng JSON của giao thức. Hãy trả về đúng MỘT đối tượng JSON theo giao thức, không thêm chữ nào khác.",
      });
      repaired = true;
      continue;
    }

    conv.state = applyStatePatch(conv.state, reply.statePatch);

    if (reply.kind === "final") {
      // Stats guard (live-eval 2026-10-28, case 5): when the user asks
      // HOW MANY reviews (a count question), the model occasionally
      // answers with invented counts and no tool call at all. A final
      // answer carrying digits is rejected until a
      // get_review_summary_stats call has succeeded in THIS turn;
      // if the rounds run out, the honest limited fallback answers
      // instead of fabricated numbers.
      const statsIntent =
        /(bao nhiêu|how many)/i.test(args.userMessage) && /(đánh giá|review)/i.test(args.userMessage);
      const statsDone = trace.toolCalls.some(
        (c) => c.tool === "get_review_summary_stats" && c.status === "ok",
      );
      if (statsIntent && !statsDone && /\d/.test(reply.answer.message ?? "")) {
        messages.push({
          role: "user",
          content:
            "Câu trả lời chưa hợp lệ: người dùng đang hỏi SỐ LƯỢNG đánh giá nhưng bạn chưa gọi get_review_summary_stats thành công trong lượt này, nên mọi con số trong câu trả lời đều không có nguồn. Hãy gọi get_review_summary_stats (dùng search_venues trước nếu chưa có venueId) rồi trả lời lại bằng số thật, nêu rõ tử số/mẫu số/phạm vi.",
        });
        repaired = true;
        continue;
      }
      // Shortlist auto-fill (live-eval 2026-10-28, case 1): the model
      // intermittently finalizes a venue_shortlist with optionIds []
      // even though compare/bookable succeeded in the same turn and
      // the message text quotes the prices — the UI then renders no
      // option cards. The registry holds the real options, so the
      // server fills the ids itself (this turn's options only,
      // restricted to the answer's venues and, when known, the
      // state's date/startTime) instead of spending a repair round.
      if (
        reply.answer.type === "venue_shortlist" &&
        (reply.answer.optionIds ?? []).length === 0 &&
        trace.toolCalls.some(
          (c) =>
            (c.tool === "compare_venue_options" || c.tool === "get_bookable_options") &&
            c.status === "ok",
        )
      ) {
        let fresh = [...conv.registry.options.values()].filter((o) => !optionsBeforeTurn.has(o.optionId));
        if (reply.answer.venueIds.length > 0) fresh = fresh.filter((o) => reply.answer.venueIds.includes(o.venueId));
        if (conv.state.dateISO) {
          const sameDay = fresh.filter((o) => o.date === conv.state.dateISO);
          if (sameDay.length > 0) fresh = sameDay;
        }
        if (conv.state.startTime) {
          const sameStart = fresh.filter((o) => o.startTime === conv.state.startTime);
          if (sameStart.length > 0) fresh = sameStart;
        }
        fresh.sort((a, b) => a.startAt.localeCompare(b.startAt) || (a.totalPrice ?? Number.MAX_SAFE_INTEGER) - (b.totalPrice ?? Number.MAX_SAFE_INTEGER));
        if (fresh.length > 0) reply.answer.optionIds = fresh.slice(0, 6).map((o) => o.optionId);
      }
      const check = validateAndHydrate(conv, reply.answer);
      if (check.ok) {
        trace.validation.answerValid = true;
        trace.validation.repaired = repaired;
        if (completion.usage || tokensIn > 0) trace.tokens = { input: tokensIn, output: tokensOut };
        if (cfg.pricePerMillion && trace.tokens) {
          trace.estimatedCostUsd =
            (tokensIn / 1_000_000) * cfg.pricePerMillion.input + (tokensOut / 1_000_000) * cfg.pricePerMillion.output;
        }
        return finish(check.answer);
      }
      messages.push({
        role: "user",
        content: `Câu trả lời chưa hợp lệ: ${check.problems.join("; ")}. Chỉ dùng venueId/evidenceId/optionId/handoffId do tool đã trả về trong hội thoại này, hoặc gọi thêm tool để lấy dữ liệu thật rồi trả lời lại.`,
      });
      repaired = true;
      continue;
    }

    // tool_call
    const def = TOOLS[reply.tool];
    if (!def) {
      messages.push({ role: "tool", content: JSON.stringify({ status: "error", error: { code: "UNKNOWN_TOOL", message: `Tool ${reply.tool} không tồn tại` } }) });
      continue;
    }
    if (def.isEvidenceTool) {
      evidenceExecutions += 1;
      if (evidenceExecutions > 1 + cfg.maxEvidenceRounds) {
        messages.push({
          role: "tool",
          content: JSON.stringify({
            status: "error",
            error: { code: ToolErrorCode.BudgetExhausted, message: "Đã hết vòng bổ sung bằng chứng cho lượt này — hãy trả lời bằng dữ liệu đã có và nêu giới hạn." },
          }),
        });
        continue;
      }
      trace.evidenceRoundsUsed = Math.max(0, evidenceExecutions - 1);
    }
    const toolStart = Date.now();
    let envelope: ToolEnvelope<unknown>;
    const ctx = { ...toolCtxBase, budget };
    try {
      envelope = await Promise.race([
        def.run(ctx, reply.input),
        new Promise<ToolEnvelope<unknown>>((resolve) =>
          setTimeout(
            () =>
              resolve({
                status: "error",
                data: null,
                appliedFilters: {},
                checkedAt: new Date().toISOString(),
                dataAsOf: null,
                warnings: [],
                provenance: {},
                evidenceRefs: [],
                error: { code: ToolErrorCode.Timeout, message: `Tool ${reply.tool} vượt quá ${cfg.toolTimeoutMs}ms` },
              }),
            cfg.toolTimeoutMs,
          ),
        ),
      ]);
    } catch (e) {
      envelope = {
        status: "error",
        data: null,
        appliedFilters: {},
        checkedAt: new Date().toISOString(),
        dataAsOf: null,
        warnings: [],
        provenance: {},
        evidenceRefs: [],
        error: { code: ToolErrorCode.DbError, message: e instanceof Error ? e.message : "Tool failed" },
      };
    }
    trace.toolCalls.push({
      tool: reply.tool,
      status: envelope.status,
      durationMs: Date.now() - toolStart,
      errorCode: envelope.error?.code ?? null,
      input: reply.input,
    });
    registerToolResult(conv, reply.tool, envelope);
    messages.push({ role: "tool", content: JSON.stringify(envelope).slice(0, 24_000) });
  }

  trace.budgetOutcome = budget.remaining <= 0 ? "exhausted" : "ok";
  trace.validation.fallbackUsed = true;
  trace.validation.repaired = repaired;
  return finish(fallbackAnswer(conv, "đã dùng hết số vòng xử lý cho lượt này"));
}

/** Test/benchmark helper: drop all conversation state. */
export function __resetConversations(): void {
  conversations.clear();
}
