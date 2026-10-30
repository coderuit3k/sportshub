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
import { clauseAspects } from "./aspects";
import { foldVi } from "./text";
import { BUSINESS_TZ, fromWallTime, todayDateISO } from "@/lib/time/tz";
import type { VenueCardData } from "./tools/shared";
import type { VenueProfileData } from "./tools/get-venue-profile";
import type { EvidenceItem } from "./tools/review-evidence";
import type { BookableOption } from "./tools/bookable-options";
import type { VenueComparison } from "./tools/compare";
import type { BookingHandoff } from "./tools/handoff";
import type { ReviewStatsData } from "./tools/review-stats";

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
  profiles: Map<string, VenueProfileData>;
  policySources: Map<string, VenueProfileData["cancellationPolicy"]>;
  evidence: Map<string, EvidenceItem>;
  options: Map<string, BookableOption>;
  handoffs: Map<string, BookingHandoff>;
  comparison: VenueComparison | null;
  /** Latest review-statistics result per venue — the ONLY source
   * from which count claims in prose may be grounded. */
  stats: Map<string, ReviewStatsData["venues"][number]>;
  /** Numbers the tools themselves were asked about (appliedFilters:
   * budgets, durations, limits) — legitimate prose facts too, e.g.
   * "vượt ngân sách tổng 150.000đ" restates the checked budget. */
  factNumbers: Set<number>;
  warnings: string[];
}

interface Conversation {
  id: string;
  /** Owner scope of this conversation: a server-derived principal
   * ("user:<id>" or "anon:<uuid>"). A conversationId alone never
   * grants access — a stored conversation is only returned to the
   * principal that created it. */
  principal: string;
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

/** Default scope for internal/test callers that pass no principal.
 * HTTP callers always pass a server-derived principal (see route). */
export const UNSCOPED_PRINCIPAL = "unscoped";

function getOrCreateConversation(
  id: string | undefined,
  clientContext?: ClientConversationContext,
  principal: string = UNSCOPED_PRINCIPAL,
): Conversation {
  const nowMs = Date.now();
  for (const [key, c] of conversations) {
    if (nowMs - c.updatedAt > CONVERSATION_TTL_MS) conversations.delete(key);
  }
  // Ownership scope: the map is keyed by principal + id, so a caller
  // presenting somebody else's conversationId simply finds nothing —
  // no state, history or registry of the owner can leak, and the
  // caller transparently starts a fresh conversation of their own.
  const key = id ? `${principal}:${id}` : null;
  if (key && conversations.has(key)) {
    const c = conversations.get(key)!;
    c.updatedAt = nowMs;
    return c;
  }
  if (conversations.size >= MAX_CONVERSATIONS) {
    const oldest = [...conversations.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
    if (oldest) conversations.delete(oldest[0]);
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
    // A client-carried conversation keeps its id across instances —
    // but ONLY when the route has verified the signed context token
    // binding that id + context to this principal. Without verified
    // client context an unknown id still starts fully fresh.
    id: clientContext && id ? id : randomUUID(),
    principal,
    state: parsedState?.success ? parsedState.data : ConversationState.parse({}),
    history,
    registry: { venues: new Map(), profiles: new Map(), policySources: new Map(), evidence: new Map(), options: new Map(), handoffs: new Map(), comparison: null, stats: new Map(), factNumbers: new Set(), warnings: [] },
    updatedAt: nowMs,
  };
  conversations.set(`${principal}:${c.id}`, c);
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
  validation: {
    answerValid: boolean;
    repaired: boolean;
    fallbackUsed: boolean;
    /** The final protocol reply parsed against the answer schema. */
    schemaValid: boolean;
    /** Every referenced venue/evidence/option/handoff id existed in
     * the tool-result registry (reference integrity — NOT claim
     * truth; see grounding). */
    referencesValid: boolean;
    /**
     * Grounding checks over the prose message, kept deliberately
     * separate from reference integrity:
     * - "passed": numeric claims matched server facts, cited
     *   evidence matched the claim's venue/aspect scope, and no
     *   provenance label was upgraded in prose.
     * - "failed": at least one check failed (the answer was then
     *   repaired or replaced by the fallback).
     * - "not_assessed": no final answer reached grounding checks.
     * Semantic entailment of free prose is NOT fully decided by
     * these checks — see docs/ai-assistant.md (grounding limits).
     */
    grounding: { status: "passed" | "failed" | "not_assessed"; problems: string[] };
    /** Number of repair rounds spent (bad JSON, invalid answers,
     * guard rejections). */
    repairCount: number;
    /** The most recent rejected final draft (problems + its message),
     * so a fallback can be attributed to the exact failed check from
     * the trace alone; null when no final was ever rejected. */
    lastRejection: { problems: string[]; message: string } | null;
    /** Whether the FIRST executed tool call of the turn succeeded
     * without an input error; null when no tool was called. */
    firstAttemptToolSuccess: boolean | null;
  };
  tokens: { input: number; output: number } | null;
  estimatedCostUsd: number | null;
}

export interface AssistantTurnResult {
  conversationId: string;
  answer: AssistantAnswer;
  trace: AssistantTrace;
  /** Server-side history summaries after this turn. The client
   * carries THESE (plus the signed context token) to the next turn,
   * so rehydration never has to trust client-authored history. */
  history: { role: "user" | "assistant"; content: string }[];
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
  for (const v of Object.values(env.appliedFilters ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) conv.registry.factNumbers.add(v);
  }
  // Result counts are legitimate prose facts ("tìm thấy 4 sân"): a
  // count the tool itself reported can never be a fabrication.
  if (typeof data.totalMatched === "number") conv.registry.factNumbers.add(data.totalMatched);
  if (tool === "search_venues") {
    const venues = (data.venues as VenueCardData[]) ?? [];
    conv.registry.factNumbers.add(venues.length);
    for (const v of venues) conv.registry.venues.set(v.venueId, v);
  }
  if (tool === "get_venue_profile") {
    const profile = data as unknown as VenueProfileData;
    conv.registry.profiles.set(profile.venueId, profile);
    conv.registry.policySources.set(profile.venueId, profile.cancellationPolicy);
  }
  if (tool === "search_review_evidence") {
    const items = (data.items as EvidenceItem[]) ?? [];
    conv.registry.factNumbers.add(items.length);
    for (const item of items) conv.registry.evidence.set(item.evidenceId, item);
  }
  if (tool === "get_bookable_options") {
    const options = (data.options as BookableOption[]) ?? [];
    conv.registry.factNumbers.add(options.length);
    for (const o of options) conv.registry.options.set(o.optionId, o);
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
    conv.registry.policySources.set(h.venueId, h.policySummary);
  }
  if (tool === "get_review_summary_stats") {
    const stats = data as unknown as ReviewStatsData;
    for (const v of stats.venues ?? []) conv.registry.stats.set(v.venueId, v);
  }
}

/* ------------------------- grounding checks --------------------------
 * Reference integrity (ids exist) does NOT prove the prose next to
 * them. The checks below are the server-side grounding layer for the
 * final message:
 *  1. NUMERIC CLAIMS — every number stated in prose must be
 *     traceable to a server fact collected from this conversation's
 *     tool results (venue cards, options, comparison rows, handoffs,
 *     review statistics, evidence ratings, conversation state).
 *     Dates, times and list ordinals are stripped before scanning.
 *  2. PROVENANCE LABELS — prose may not upgrade a price to
 *     "official" / "owner-confirmed" when the underlying venue's
 *     price provenance is platform_reference.
 *  3. CITATION SCOPE — cited evidence must belong to a venue the
 *     answer is about, and the sentence carrying the citation must
 *     overlap the evidence's aspects (a staff review cannot support
 *     a cleanliness claim).
 * These checks bound numeric and cited claims; they do NOT decide
 * semantic entailment of arbitrary free prose. That residual limit
 * is recorded honestly in the trace (grounding status) and docs.
 */

interface FactNumbers {
  ints: Set<number>;
  floats: Set<number>;
}

function addFactNumbers(n: FactNumbers, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) n.ints.add(value);
    else n.floats.add(value);
  }
}

function addStringDigits(n: FactNumbers, s: string | null | undefined): void {
  if (!s) return;
  for (const m of s.matchAll(/\d+/g)) n.ints.add(Number.parseInt(m[0], 10));
}

function collectFactNumbers(
  conv: Conversation,
  draft: Extract<z.infer<typeof ModelReply>, { kind: "final" }>["answer"],
  currentUserMessage?: string,
): FactNumbers {
  const n: FactNumbers = { ints: new Set(), floats: new Set() };
  for (const v of conv.registry.venues.values()) {
    addFactNumbers(n, v.googleRating);
    addFactNumbers(n, v.googleRatingCount);
    addFactNumbers(n, v.inAppRating);
    addFactNumbers(n, v.inAppRatingCount);
    addFactNumbers(n, v.minReferenceHourlyPrice);
    addStringDigits(n, v.name);
    addStringDigits(n, v.address);
    addStringDigits(n, v.district);
  }
  for (const id of draft.venueIds) {
    const profile = conv.registry.profiles.get(id);
    if (!profile) continue;
    addStringDigits(n, profile.name);
    addStringDigits(n, profile.address);
    addStringDigits(n, profile.district);
  }
  for (const id of draft.venueIds) {
    const policy = conv.registry.policySources.get(id);
    if (!policy) continue;
    addFactNumbers(n, policy.fullRefundBeforeHours);
    addFactNumbers(n, policy.partialRefundBeforeHours);
    addFactNumbers(n, policy.partialFeePercent);
    addFactNumbers(n, 100); // a full refund is 100%; partial refund is 100 minus the verified fee
  }
  for (const o of conv.registry.options.values()) {
    addFactNumbers(n, o.totalPrice);
    addFactNumbers(n, o.durationHours);
    for (const b of o.pricePerHourBreakdown ?? []) addFactNumbers(n, b.pricePerHour);
    addStringDigits(n, o.facilityName);
  }
  const comp = conv.registry.comparison;
  if (comp) {
    for (const row of comp.rows) for (const val of row.values) addFactNumbers(n, val);
    for (const pv of comp.perVenue) if (pv.bestOption) addFactNumbers(n, pv.bestOption.totalPrice);
  }
  for (const h of conv.registry.handoffs.values()) {
    addFactNumbers(n, h.totalPrice);
    addFactNumbers(n, h.durationHours);
    addFactNumbers(n, h.policySummary.fullRefundBeforeHours);
    addFactNumbers(n, h.policySummary.partialRefundBeforeHours);
    addFactNumbers(n, h.policySummary.partialFeePercent);
  }
  for (const s of conv.registry.stats.values()) {
    if (s.googleAggregate) {
      addFactNumbers(n, s.googleAggregate.rating);
      addFactNumbers(n, s.googleAggregate.count);
    }
    if (s.googleSample) {
      addFactNumbers(n, s.googleSample.reviewCount);
      addFactNumbers(n, s.googleSample.averageRating);
      for (const [k, val] of Object.entries(s.googleSample.ratingDistribution)) {
        addFactNumbers(n, Number(k));
        addFactNumbers(n, val);
      }
      for (const a of s.googleSample.aspects) {
        addFactNumbers(n, a.positive);
        addFactNumbers(n, a.negative);
        addFactNumbers(n, a.mixed);
        addFactNumbers(n, a.mentioningReviews);
        addFactNumbers(n, a.sampleSize);
      }
    }
    if (s.inApp) {
      addFactNumbers(n, s.inApp.reviewCount);
      addFactNumbers(n, s.inApp.seedReviewCount);
      addFactNumbers(n, s.inApp.averageRating);
      for (const [k, val] of Object.entries(s.inApp.ratingDistribution)) {
        addFactNumbers(n, Number(k));
        addFactNumbers(n, val);
      }
    }
  }
  for (const e of conv.registry.evidence.values()) addFactNumbers(n, e.rating);
  for (const v of conv.registry.factNumbers) addFactNumbers(n, v);
  // Numbers the USER stated are given context, not fabrications: a
  // model echoing the request's own threshold ("điểm từ 4 trở lên")
  // must not be rejected for restating it. (Real-model run
  // 2026-10-28: four fallbacks burned every repair round on the
  // user's own "4".)
  // NOTE: conv.history only gains the current message in finish(),
  // so the caller passes it explicitly; earlier user turns come from
  // history.
  for (const h of conv.history) {
    if (h.role !== "user") continue;
    for (const { value } of extractProseNumbers(h.content)) addFactNumbers(n, value);
  }
  if (currentUserMessage) {
    for (const { value } of extractProseNumbers(currentUserMessage)) addFactNumbers(n, value);
  }
  // Conversation state + answer shape are also legitimate sources
  // ("chơi 2 tiếng", "tìm được 2 sân", the slot's day/month/year).
  addFactNumbers(n, conv.state.durationHours);
  addFactNumbers(n, conv.state.budgetAmount);
  addFactNumbers(n, draft.venueIds.length);
  addFactNumbers(n, draft.optionIds.length);
  addFactNumbers(n, draft.evidenceIds.length);
  if (conv.state.dateISO) for (const part of conv.state.dateISO.split("-")) addFactNumbers(n, Number(part));
  return n;
}

/** Numbers the prose states, with dates/times/ordinals stripped. */
function extractProseNumbers(message: string): { value: number; isPercent: boolean }[] {
  const cleaned = message
    .replace(/\d{4}-\d{2}-\d{2}/g, " ") // ISO dates
    // dd/mm(/yyyy), 24/7 — but NOT the tail of a decimal fraction:
    // in "4.6/5" the "6/5" is a rating denominator, and stripping it
    // as a date leaves a phantom integer "4" that grounding then
    // rejects (real-model runs 2026-10-28, cases AI-005/AI-017 —
    // visible once lastRejection drafts were recorded). The
    // lookbehind refuses a match glued to a digit or a decimal
    // separator; real dates are preceded by space/punctuation.
    .replace(/(?<![\d.,])\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ") // hh:mm
    .replace(/^\s*\d+[.)]\s+/gm, " "); // list ordinals "1. ", "2) "
  const out: { value: number; isPercent: boolean }[] = [];
  for (const m of cleaned.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g)) {
    const raw = m[0];
    const tail = cleaned.slice((m.index ?? 0) + raw.length, (m.index ?? 0) + raw.length + 1);
    let value: number;
    if (/^\d{1,3}(\.\d{3})+$/.test(raw)) value = Number(raw.replace(/\./g, ""));
    else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(raw)) value = Number(raw.replace(/\./g, "").replace(",", "."));
    else value = Number(raw.replace(",", "."));
    if (Number.isFinite(value)) out.push({ value, isPercent: tail === "%" });
  }
  return out;
}

function claimsDifferentVenue(conv: Conversation, venueId: string, foldedClause: string): boolean {
  const profile = conv.registry.profiles.get(venueId);
  const card = conv.registry.venues.get(venueId);
  const handoff = [...conv.registry.handoffs.values()].find((h) => h.venueId === venueId);
  const targetName = foldVi(profile?.name ?? card?.name ?? handoff?.venueName ?? "");
  const targetLocation = foldVi(`${profile?.district ?? card?.district ?? handoff?.venueDistrict ?? ""} ${profile?.address ?? card?.address ?? ""} ${profile?.description ?? ""}`);
  const otherVenues = [...conv.registry.venues.values(), ...conv.registry.profiles.values()]
    .filter((venue) => venue.venueId !== venueId);
  const otherNames = otherVenues.map((venue) => foldVi(venue.name))
    .filter((name) => name.length >= 8 && !targetName.includes(name));
  const otherDistricts = otherVenues.map((venue) => foldVi(venue.district));
  const districtMentions = [...foldedClause.matchAll(/\b(?:quan|district)\s+\d+\b|\bthu duc\b/g)].map((m) => m[0]);
  return otherNames.some((name) => foldedClause.includes(name)) ||
    [...otherDistricts, ...districtMentions].some((district) => district && !targetLocation.includes(district) && foldedClause.includes(district));
}

function groundingProblems(
  conv: Conversation,
  draft: Extract<z.infer<typeof ModelReply>, { kind: "final" }>["answer"],
  currentUserMessage?: string,
): string[] {
  const problems: string[] = [];
  const facts = collectFactNumbers(conv, draft, currentUserMessage);
  for (const { value, isPercent } of extractProseNumbers(draft.message)) {
    if (Number.isInteger(value)) {
      if (facts.ints.has(value) || facts.floats.has(value)) continue;
      if (isPercent && facts.ints.has(100 - value)) continue; // "hoàn 70%" from a 30% fee
      problems.push(`số ${value} trong câu trả lời không có trong dữ kiện do tool cung cấp`);
    } else {
      const ok = [...facts.floats].some((f) => Math.abs(f - value) <= 0.051) || facts.ints.has(Math.round(value));
      if (!ok) problems.push(`số ${value} trong câu trả lời không có trong dữ kiện do tool cung cấp`);
    }
  }
  // shortcut: parse common opening-hours wording and HH:MM; extend for new phrasing seen in real-model runs.
  for (const clause of draft.message.split(/[.!?;\n]+/)) {
    const foldedClause = foldVi(clause);
    const cues = [...foldedClause.matchAll(/\b(mo cua|dong cua|gio hoat dong|gio mo|gio dong|mo tu|mo luc|dong luc|hoat dong tu|opening hours|open from|opens from|opens at|closes at)\b/g)];
    if (cues.length === 0) continue;
    const times = [...clause.matchAll(/\b(?:[01]?\d|2[0-3]|24):[0-5]\d\b/g)].map((m) => m[0].padStart(5, "0"));
    const allDayClaim = /\b(ca ngay|suot ngay|24\/7|all day|24 hours)\b/.test(foldedClause);
    if (times.length === 0 && /\b(chua kiem tra|chua ro|chua duoc xac minh|chua xac minh|khong biet|khong ro|khong co du lieu)\b/.test(foldedClause)
      && cues.length === 1 && !allDayClaim && !/\b(nhung|but)\b/.test(foldedClause)) continue;
    if (times.length === 0 && cues.length === 1 && !allDayClaim && /^ban\b/.test(foldedClause)
      && /\b(may gio|san nao|gio nao|bao gio)\b/.test(foldedClause)) continue;
    const profile = draft.venueIds.length === 1 ? conv.registry.profiles.get(draft.venueIds[0]) : null;
    if (!profile) {
      problems.push("giờ mở cửa cần get_venue_profile trong lượt này và venueIds chứa đúng venueId từ profile");
      continue;
    }
    if (claimsDifferentVenue(conv, profile.venueId, foldedClause)) {
      problems.push("giờ mở cửa trong câu trả lời thuộc sân khác với venueIds/profile đã kiểm tra");
      continue;
    }
    if (times.length === 0 && cues.length === 1 && !allDayClaim
      && /\b(chuan hoa|nhap tu google|imported from google)\b/.test(foldedClause)) {
      if (profile.provenance.operatingHours !== "imported") problems.push("nguồn giờ mở cửa trong câu trả lời không khớp profile");
      continue;
    }
    const dayNames = [
      ["chu nhat", "sunday"], ["thu hai", "monday"], ["thu ba", "tuesday"], ["thu tu", "wednesday"],
      ["thu nam", "thursday"], ["thu sau", "friday"], ["thu bay", "saturday"],
    ];
    const days = dayNames.flatMap((names, dayOfWeek) =>
      names.some((name) => new RegExp(`\\b${name}\\b`).test(foldedClause)) ? [dayOfWeek] : []);
    if (days.length > 1) {
      problems.push("giờ mở cửa cho nhiều ngày cần được tách và kiểm tra từng ngày");
      continue;
    }
    const day = /\b(hang ngay|moi ngay|daily|every day)\b/.test(foldedClause) ? -1 : (days[0] ?? -1);
    const hours = day >= 0 ? profile.operatingHours.filter((h) => h.dayOfWeek === day) : profile.operatingHours;
    const matches = hours.length === (day >= 0 ? 1 : 7) && hours.every((h) =>
      times.length === 2 ? h.openTime === times[0] && h.closeTime === times[1]
        : times.length === 1 && /\b(dong cua|dong luc|gio dong|closes at)\b/.test(foldedClause)
          ? h.closeTime === times[0]
          : times.length === 1 && /\b(mo cua|mo tu|mo luc|gio mo|open from|opens from|opens at)\b/.test(foldedClause) && h.openTime === times[0],
    );
    if (!matches) problems.push("giờ mở cửa trong câu trả lời không khớp giờ hoạt động của sân/ngày từ get_venue_profile");
  }
  // shortcut: validate common refund thresholds/fees in prose; extend for new wording seen in model traces.
  const policyQuestion = /\b(chinh sach huy|chinh sach hoan tien|hoan tien|refund|cancellation)\b/.test(foldVi(currentUserMessage ?? ""));
  const policyInAnswer = /\b(chinh sach huy|huy truoc|hoan tien|hoan toan bo|refund|cancellation|chiu phi|phi huy)\b/.test(foldVi(draft.message));
  for (const clause of draft.message.split(/[.!?;\n]+|,\s+|\s+(?:và|nhưng|and|but)\s+/i)) {
    const claim = foldVi(clause);
    if (!/\b(chinh sach huy|huy truoc|hoan tien|hoan toan bo|hoan mot phan|refund|cancellation|chiu phi|phi huy)\b/.test(claim)
      && !((policyQuestion || policyInAnswer) && /\b(phi|hoan|huy)\b/.test(claim))) continue;
    if (/^ban\b/.test(claim) && /\bsan nao\b/.test(claim) && !/\d/.test(claim)) continue;
    if (/\b(chua kiem tra|chua ro|chua duoc xac minh|khong biet|khong ro|khong co du lieu)\b/.test(claim)
      && !/\d/.test(claim) && !/\b(chu san xac nhan|owner verified)\b/.test(claim)) continue;
    const policy = draft.venueIds.length === 1 ? conv.registry.policySources.get(draft.venueIds[0]) : null;
    if (!policy) {
      problems.push("chính sách hủy cần get_venue_profile hoặc prepare_booking_handoff cho đúng sân trong lượt này");
      continue;
    }
    if (claimsDifferentVenue(conv, draft.venueIds[0], claim)) {
      problems.push("chính sách hủy trong câu trả lời thuộc sân khác với nguồn đã kiểm tra");
      continue;
    }
    const ownerClaim = /\b(chu san (da )?xac nhan|owner verified)\b/.test(claim)
      && !/\b(chua|khong|not)\b.{0,30}\b(chu san (da )?xac nhan|owner verified)\b/.test(claim);
    if ((ownerClaim && policy.provenance !== "owner_verified") ||
      (/\b(chinh sach tham chieu|tham chieu cua nen tang|platform reference)\b/.test(claim)
        && policy.provenance !== "platform_reference")) {
      problems.push("nguồn chính sách hủy trong câu trả lời không khớp tool");
    }
    const beforeHours = [...claim.matchAll(/\b(?:truoc|before)\s+(\d+(?:[.,]\d+)?)\s*(?:gio|tieng|hours?|h)\b/g)]
      .map((m) => Number(m[1].replace(",", ".")));
    const percents = [...claim.matchAll(/\b(\d+(?:[.,]\d+)?)\s*%/g)].map((m) => Number(m[1].replace(",", ".")));
    const refundPercents = [...claim.matchAll(/\bhoan(?: tien)?\s+(\d+(?:[.,]\d+)?)\s*%/g)]
      .map((m) => Number(m[1].replace(",", ".")));
    const feePercents = [...claim.matchAll(/\bphi(?: huy)?\s+(\d+(?:[.,]\d+)?)\s*%|\bmat\s+(\d+(?:[.,]\d+)?)\s*%|(\d+(?:[.,]\d+)?)\s*%\s*phi\b/g)]
      .map((m) => Number((m[1] ?? m[2] ?? m[3]).replace(",", ".")));
    const full = /\b(hoan toan bo|hoan day du|full refund)\b/.test(claim) || refundPercents.includes(100);
    const fee = /\b(chiu phi|phi huy|muc phi|cancellation fee)\b/.test(claim)
      || ((policyQuestion || policyInAnswer) && /\bphi\b/.test(claim));
    const partial = /\b(hoan(?: tien)? mot phan|partial refund)\b/.test(claim)
      || refundPercents.some((percent) => percent !== 100);
    const window = claim.match(/\btu\s+(\d+)\s*[–—-]\s*(\d+)\s*(?:gio|tieng|h)\s+truoc\b/);
    const underCutoff = claim.match(/\bduoi\s+(\d+)\s*(?:gio|tieng|h)\s+truoc\b/);
    if (full && beforeHours.some((hours) => hours !== policy.fullRefundBeforeHours)) {
      problems.push("ngưỡng hoàn toàn bộ không khớp chính sách hủy của sân");
    }
    if ((fee || partial) && beforeHours.some((hours) => hours !== policy.partialRefundBeforeHours)) {
      problems.push("ngưỡng hoàn một phần không khớp chính sách hủy của sân");
    }
    if (fee && feePercents.some((percent) => percent !== policy.partialFeePercent)) {
      problems.push("phí hủy không khớp chính sách hủy của sân");
    }
    if (partial && refundPercents.some((percent) => percent !== 100 - policy.partialFeePercent)) {
      problems.push("tỷ lệ hoàn tiền không khớp chính sách hủy của sân");
    }
    if (window && (Number(window[1]) !== policy.partialRefundBeforeHours || Number(window[2]) !== policy.fullRefundBeforeHours)) {
      problems.push("khoảng hoàn một phần không khớp chính sách hủy của sân");
    }
    if (underCutoff && /\bkhong hoan\b/.test(claim) && Number(underCutoff[1]) !== policy.partialRefundBeforeHours) {
      problems.push("ngưỡng không hoàn tiền không khớp chính sách hủy của sân");
    }
    if (underCutoff && partial) problems.push("không thể khẳng định hoàn một phần dưới ngưỡng không hoàn tiền");
    if (!full && !fee && !partial && (beforeHours.length > 0 || percents.length > 0) && !underCutoff) {
      problems.push("khẳng định chính sách hủy thiếu điều kiện hoàn tiền hoặc phí tương ứng");
    }
  }
  // Provenance labels may never be upgraded in prose. The check is
  // negation-aware per clause: "đây KHÔNG PHẢI giá chính thức" and
  // "giá CHƯA được chủ sân xác nhận" state the truth and must pass —
  // the v7 substring check flagged them anyway, and a comparison
  // final that kept restating the (correct) denial burned all its
  // repair rounds on it (real-model run 2026-10-28, case AI-024).
  const folded = foldVi(draft.message);
  const clauses = folded.split(/[.!?;\n]+/);
  const affirmedPhrase = (phrases: string[], inClause?: RegExp): boolean =>
    clauses.some((clause) =>
      (!inClause || inClause.test(clause)) &&
      phrases.some((p) => {
        const idx = clause.indexOf(p);
        if (idx < 0) return false;
        const before = clause.slice(Math.max(0, idx - 60), idx);
        return !/\b(khong|chua|chang|not|no)\b/.test(before);
      }),
    );
  if (affirmedPhrase(["gia chinh thuc", "official price"])) {
    problems.push("câu trả lời gọi giá là 'chính thức' nhưng giá trong hệ thống là giá tham chiếu của nền tảng");
  }
  const ownerConfirmedClaim = affirmedPhrase(["chu san xac nhan", "chu san da xac nhan", "owner-verified price", "owner verified price"], /\b(gia|price)\b/);
  if (ownerConfirmedClaim) {
    const referenced = draft.venueIds
      .map((id) => conv.registry.venues.get(id))
      .filter((v): v is VenueCardData => !!v);
    const allOwnerPriced = referenced.length > 0 && referenced.every((v) => v.priceType === "owner_verified");
    if (!allOwnerPriced) {
      problems.push("câu trả lời khẳng định giá đã được chủ sân xác nhận nhưng provenance của giá là platform_reference");
    }
  }
  // Citation scope: entity + aspect.
  const answerVenueIds = new Set(
    draft.type === "venue_comparison" && conv.registry.comparison
      ? conv.registry.comparison.venueIds
      : draft.venueIds,
  );
  const sentences = draft.message.split(/(?<=[.!?])\s+|\n+/);
  for (const sentence of sentences) {
    for (const m of sentence.matchAll(/\[ev:([^\]]+)\]/g)) {
      const ev = conv.registry.evidence.get(m[1]);
      if (!ev) continue; // unknown ids are reference problems, handled by the caller
      if (answerVenueIds.size > 0 && !answerVenueIds.has(ev.venueId)) {
        problems.push(`evidence ${m[1]} thuộc sân khác (${ev.venueName}) với các sân trong câu trả lời`);
      }
      const claimed = clauseAspects(foldVi(sentence));
      if (claimed.length > 0 && !claimed.some((a) => ev.aspects.includes(a))) {
        problems.push(
          `evidence ${m[1]} (khía cạnh: ${ev.aspects.join(", ") || "không rõ"}) không hỗ trợ claim về ${claimed.join(", ")} trong cùng câu`,
        );
      }
    }
  }
  // Note: citations may be carried either inline ([ev:<id>] in the
  // sentence, scope-checked above) or structurally (evidenceIds →
  // hydrated evidence cards rendered under the message). Both are
  // legitimate in the protocol; only inline markers get the
  // sentence-scope check, because only they bind a claim to a source.
  return problems;
}

function validateAndHydrate(
  conv: Conversation,
  draft: Extract<z.infer<typeof ModelReply>, { kind: "final" }>["answer"],
  currentUserMessage?: string,
): { ok: true; answer: AssistantAnswer } | { ok: false; problems: string[]; referenceProblems: string[]; groundingProblems: string[] } {
  const problems: string[] = [];
  // For a comparison answer, venueIds reference the comparison result
  // itself (validated separately below) — the comparison tool does not
  // mint venue cards, so the card-registry check does not apply.
  if (draft.type !== "venue_comparison") {
    for (const id of draft.venueIds) {
      if (!conv.registry.venues.has(id) && !(draft.type === "limited_answer" && (conv.registry.profiles.has(id) || conv.registry.policySources.has(id)))) {
        problems.push(`unknown venueId ${id}`);
      }
    }
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
  const grounding = groundingProblems(conv, draft, currentUserMessage);
  if (problems.length > 0 || grounding.length > 0) {
    return { ok: false, problems: [...problems, ...grounding], referenceProblems: problems, groundingProblems: grounding };
  }
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
   * instance that has never seen it (see ClientConversationContext).
   * HTTP callers must only pass context whose signed token they have
   * verified for this principal (see src/lib/ai/session.ts). */
  clientContext?: ClientConversationContext;
  /** Server-derived owner scope for the conversation (session user
   * or signed anonymous id). Never taken from the request body. */
  principal?: string;
}

export async function runAssistantTurn(args: RunTurnArgs): Promise<AssistantTurnResult> {
  const cfg = args.cfg ?? loadAiConfig();
  const now = args.now ?? new Date();
  const startedAtMs = Date.now();
  const traceId = randomUUID();
  const conv = getOrCreateConversation(args.conversationId, args.clientContext, args.principal);
  conv.registry.profiles.clear(); // hours must come from a profile checked in this user turn
  conv.registry.policySources.clear(); // policy must come from a profile or handoff checked in this turn
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
    validation: {
      answerValid: false,
      repaired: false,
      fallbackUsed: false,
      schemaValid: false,
      referencesValid: false,
      grounding: { status: "not_assessed", problems: [] },
      repairCount: 0,
      lastRejection: null,
      firstAttemptToolSuccess: null,
    },
    tokens: null,
    estimatedCostUsd: null,
  };

  // Usage accounting is centralized in finish() so EVERY exit path
  // (success, limited fallback, timeout, provider failure, budget
  // exhaustion) records the tokens/cost actually spent — previously
  // only a validated final answer did, which understated cost on
  // exactly the turns that went wrong.
  let tokensIn = 0;
  let tokensOut = 0;
  let repairCount = 0;

  const finish = (answer: AssistantAnswer): AssistantTurnResult => {
    trace.latencyMs = Date.now() - startedAtMs;
    trace.budgetUsed = budget.usedCount;
    trace.validation.repaired = repairCount > 0;
    trace.validation.repairCount = repairCount;
    if (tokensIn + tokensOut > 0) {
      trace.tokens = { input: tokensIn, output: tokensOut };
      if (cfg.pricePerMillion) {
        trace.estimatedCostUsd =
          (tokensIn / 1_000_000) * cfg.pricePerMillion.input + (tokensOut / 1_000_000) * cfg.pricePerMillion.output;
      }
    }
    conv.history.push({ role: "user", content: args.userMessage.slice(0, 2000) });
    conv.history.push({ role: "assistant", content: `[${answer.type}] ${answer.message}`.slice(0, 2000) });
    if (conv.history.length > 24) conv.history = conv.history.slice(-24);
    return { conversationId: conv.id, answer, trace, history: [...conv.history] };
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

  let evidenceExecutions = 0;
  let slotGuardUsed = false;
  let searchGuardUsed = false;
  let compareGuardUsed = false;
  let policyGuardUsed = false;
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
      completion = await args.model.complete(messages, { timeoutMs: cfg.modelTimeoutMs, maxTokens: cfg.maxOutputTokens });
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
    // Per-request token budget, checked BETWEEN rounds: the call
    // that crosses the line has already been paid for (that overshoot
    // is bounded by one call's max output + the round's input), but
    // no further rounds are bought once the budget is spent.
    if (tokensIn + tokensOut > cfg.maxTotalTokens) {
      trace.budgetOutcome = "exhausted";
      trace.validation.fallbackUsed = true;
      return finish(fallbackAnswer(conv, "đã vượt ngân sách token cho lượt này"));
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
      repairCount += 1;
      continue;
    }

    // Registry freshness: when the model's patch CHANGES any
    // slot-defining slot (sport, district, date, start, duration,
    // budget, venue set), every option/handoff/comparison gathered
    // under the old requirements is stale by definition and must not
    // be issued for the new state. Clear them; the model re-checks
    // with the read-only tools (the registry rebuilds from real
    // results only). Venue cards, evidence and stats survive — they
    // are not slot-specific — but see the freshness limits in
    // docs/ai-assistant.md.
    const prevState = conv.state;
    conv.state = applyStatePatch(conv.state, reply.statePatch);
    const SLOT_KEYS = ["sportSlug", "district", "dateISO", "startTime", "durationHours", "budgetAmount", "budgetBasis", "venueIds"] as const;
    if (SLOT_KEYS.some((k) => JSON.stringify(prevState[k]) !== JSON.stringify(conv.state[k]))) {
      conv.registry.options.clear();
      conv.registry.handoffs.clear();
      conv.registry.comparison = null;
    }

    if (reply.kind === "final") {
      trace.validation.schemaValid = true;
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
        repairCount += 1;
        continue;
      }
      // Slot-check guard (live-eval 2026-10-28, case 1 re-probe):
      // once the conversation state contains a complete slot (date +
      // start time + duration), a shortlist/comparison must be backed
      // by an actual availability/price check in THIS turn. Otherwise
      // the model can present hourly reference prices as if the slot
      // had been checked and ask the user to choose before doing the
      // central Demo A step. Reject the first such final once; if the
      // model still chooses to answer after the nudge, its answer is
      // allowed rather than trapping the turn in a repair loop.
      const slotKnown = Boolean(conv.state.dateISO && conv.state.startTime && conv.state.durationHours);
      const slotChecked = trace.toolCalls.some(
        (c) =>
          (c.tool === "compare_venue_options" || c.tool === "get_bookable_options") &&
          c.status === "ok",
      );
      if (
        !slotGuardUsed &&
        slotKnown &&
        !slotChecked &&
        (reply.answer.type === "venue_shortlist" || reply.answer.type === "venue_comparison") &&
        reply.answer.venueIds.length > 0 &&
        (reply.answer.optionIds ?? []).length === 0
      ) {
        messages.push({
          role: "user",
          content:
            `Câu trả lời chưa hợp lệ: hội thoại đã có đủ ngày (${conv.state.dateISO}), giờ bắt đầu (${conv.state.startTime}) và thời lượng (${conv.state.durationHours} giờ), nhưng bạn chưa kiểm tra lịch/giá thành công trong lượt này. Không được dùng giá tham chiếu theo giờ để kết luận sân phù hợp với khung giờ/ngân sách. Hãy gọi compare_venue_options cho tối đa 3 venueId trong danh sách (hoặc get_bookable_options nếu chỉ có 1 sân), dùng đúng ngày/giờ/thời lượng trong state, rồi trả lời lại bằng option thật; nếu không còn trống thì nói rõ điều đó.`,
        });
        repairCount += 1;
        slotGuardUsed = true;
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
      // Search guard (real-model run 2026-10-28, case AI-011): the
      // model repeatedly submitted venue_shortlist finals WITHOUT ever
      // calling search_venues — every draft failed validation and the
      // turn ended in fallback with zero tool calls. A shortlist that
      // names no venue while the registry is still empty means the
      // search never happened: nudge exactly once to run it.
      if (
        !searchGuardUsed &&
        reply.answer.type === "venue_shortlist" &&
        reply.answer.venueIds.length === 0 &&
        conv.registry.venues.size === 0 &&
        conv.registry.options.size === 0 &&
        !conv.registry.comparison &&
        // A search that ran and matched nothing (status "empty") DID
        // happen — an empty shortlist is then the honest answer, not
        // this pathology. Only a turn with no executed search at all
        // (and no options/comparison from other tools) is nudged.
        !trace.toolCalls.some((c) => c.tool === "search_venues" && c.status !== "error")
      ) {
        messages.push({
          role: "user",
          content:
            "Câu trả lời chưa hợp lệ: bạn chưa gọi search_venues thành công trong hội thoại này nên chưa có sân nào để giới thiệu. Hãy gọi search_venues ngay với tiêu chí người dùng đã nêu (môn, khu vực, điểm tối thiểu nếu có), rồi trả lời bằng các venueId thật từ kết quả.",
        });
        repairCount += 1;
        searchGuardUsed = true;
        continue;
      }
      // Compare-intent guard (real-model runs 2026-10-28, case
      // AI-024): asked to compare two NAMED venues at a fully
      // specified slot, the model repeatedly answered with a
      // clarification demanding sport + budget and called no tool at
      // all — even after prompt v9 told it to search by name and
      // infer the sport. When the request itself carries compare
      // intent plus a complete slot and the model has done nothing,
      // nudge exactly once to search by name and compare; a second
      // clarification is the model's choice and stands.
      const compareIntent = /(so sánh|compare)/i.test(args.userMessage);
      const slotInState = Boolean(conv.state.dateISO && conv.state.startTime && conv.state.durationHours);
      const slotInMessage = /\d{1,2}:\d{2}/.test(args.userMessage) && /(tiếng|giờ|hours?)/i.test(args.userMessage);
      if (
        !compareGuardUsed &&
        compareIntent &&
        (slotInState || slotInMessage) &&
        reply.answer.type === "clarification" &&
        trace.toolCalls.length === 0
      ) {
        messages.push({
          role: "user",
          content:
            "Câu trả lời chưa hợp lệ: người dùng đã nêu tên các sân cần so sánh cùng ngày/giờ và thời lượng cụ thể — đừng hỏi lại môn hay ngân sách. Hãy gọi search_venues theo TÊN sân để lấy venueId (môn lấy từ kết quả search), rồi gọi compare_venue_options với đúng ngày/giờ/thời lượng đó và trả lời bằng kết quả so sánh thật.",
        });
        repairCount += 1;
        compareGuardUsed = true;
        continue;
      }
      // A named venue's cancellation policy is in its profile. An
      // unsupported "not checked" final after zero tool calls loses
      // the user's task even though it avoids a fabricated claim.
      if (!policyGuardUsed && conv.registry.policySources.size === 0 && trace.toolCalls.length === 0
        && reply.answer.type === "limited_answer"
        && /\b(chinh sach huy|chinh sach hoan tien|hoan tien)\b/.test(foldVi(args.userMessage))
        && (/(?:\bsan\b\s+\S+|\bcua san\b)/.test(foldVi(args.userMessage)) || conv.state.venueIds.length === 1)) {
        messages.push({ role: "user", content:
          "Người dùng hỏi chính sách hủy của một sân đã nêu. Hãy tìm đúng venueId bằng search_venues nếu chưa có, hỏi phân biệt nếu có nhiều sân phù hợp, rồi gọi get_venue_profile để lấy chính sách hủy trước khi trả lời. Không suy đoán chính sách từ câu hỏi." });
        repairCount += 1;
        policyGuardUsed = true;
        continue;
      }
      const check = validateAndHydrate(conv, reply.answer, args.userMessage);
      if (check.ok) {
        trace.validation.answerValid = true;
        trace.validation.referencesValid = true;
        trace.validation.grounding = { status: "passed", problems: [] };
        return finish(check.answer);
      }
      trace.validation.referencesValid = check.referenceProblems.length === 0;
      if (check.groundingProblems.length > 0) {
        trace.validation.grounding = { status: "failed", problems: check.groundingProblems };
      }
      trace.validation.lastRejection = { problems: check.problems, message: reply.answer.message };
      // The rejection names the offending numbers but, until v8, never
      // said which numbers ARE allowed — models guessed, re-offended
      // and burned every repair round (real-model run 2026-10-28:
      // five fallbacks with 5–8 repairs each). State the whitelist.
      const allowed = collectFactNumbers(conv, reply.answer, args.userMessage);
      const allowedInts = [...allowed.ints].sort((a, b) => a - b).slice(0, 60);
      const allowedFloats = [...allowed.floats].sort((a, b) => a - b).slice(0, 30);
      messages.push({
        role: "user",
        content:
          `Câu trả lời chưa hợp lệ: ${check.problems.join("; ")}. Chỉ dùng venueId/evidenceId/optionId/handoffId do tool đã trả về trong hội thoại này, hoặc gọi thêm tool để lấy dữ liệu thật rồi trả lời lại. ` +
          `Các số ĐƯỢC PHÉP xuất hiện trong message: ${[...allowedInts.map(String), ...allowedFloats.map(String)].join(", ") || "(không có — hãy viết message không chứa con số nào)"}. Mọi con số ngoài danh sách này phải bỏ hẳn; không làm tròn số thập phân (viết nguyên văn số tool trả về).`,
      });
      repairCount += 1;
      continue;
    }

    // tool_call
    const def = TOOLS[reply.tool];
    if (!def) {
      messages.push({ role: "tool", content: JSON.stringify({ status: "error", error: { code: "UNKNOWN_TOOL", message: `Tool ${reply.tool} không tồn tại` } }) });
      continue;
    }
    // Evidence-round accounting (audit D): a supplementary evidence
    // round is consumed only by an execution that actually GATHERS
    // data (status ok/empty/partial). An execution rejected for
    // invalid input — or any other error — must not burn the round:
    // the model still needs it to repair the input and fetch the
    // evidence. Failed attempts remain bounded by the total tool
    // budget, the model-round cap and this same refusal once the
    // gathering cap is genuinely reached.
    if (def.isEvidenceTool && evidenceExecutions >= 1 + cfg.maxEvidenceRounds) {
      messages.push({
        role: "tool",
        content: JSON.stringify({
          status: "error",
          error: { code: ToolErrorCode.BudgetExhausted, message: "Đã hết vòng bổ sung bằng chứng cho lượt này — hãy trả lời bằng dữ liệu đã có và nêu giới hạn." },
        }),
      });
      continue;
    }
    const toolStart = Date.now();
    let envelope: ToolEnvelope<unknown>;
    const ctx = { ...toolCtxBase, budget };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      envelope = await Promise.race([
        def.run(ctx, reply.input),
        new Promise<ToolEnvelope<unknown>>((resolve) => {
          timer = setTimeout(
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
          );
        }),
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
    if (timer) clearTimeout(timer);
    trace.toolCalls.push({
      tool: reply.tool,
      status: envelope.status,
      durationMs: Date.now() - toolStart,
      errorCode: envelope.error?.code ?? null,
      input: reply.input,
    });
    if (trace.toolCalls.length === 1) {
      trace.validation.firstAttemptToolSuccess = envelope.status !== "error";
    }
    if (def.isEvidenceTool && envelope.status !== "error") {
      evidenceExecutions += 1;
      trace.evidenceRoundsUsed = Math.max(0, evidenceExecutions - 1);
    }
    registerToolResult(conv, reply.tool, envelope);
    messages.push({ role: "tool", content: JSON.stringify(envelope).slice(0, 24_000) });
  }

  trace.budgetOutcome = budget.remaining <= 0 ? "exhausted" : "ok";
  trace.validation.fallbackUsed = true;
  return finish(fallbackAnswer(conv, "đã dùng hết số vòng xử lý cho lượt này"));
}

/** Test/benchmark helper: drop all conversation state. */
export function __resetConversations(): void {
  conversations.clear();
}
