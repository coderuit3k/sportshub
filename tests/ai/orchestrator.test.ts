/**
 * Orchestrator tests with a ScriptedModel (tests only — production
 * always uses the configured provider). The scripts play the model's
 * part of the JSON protocol; the assertions grade the ORCHESTRATION:
 * budget enforcement, evidence-round caps, answer validation against
 * real tool results, state override, and honest degradation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createAiFixtureDb, SAT } from "./fixtures";
import { runAssistantTurn, __resetConversations } from "@/lib/ai/orchestrator";
import { ScriptedModel, type ModelMessage } from "@/lib/ai/provider";
import { loadAiConfig, type AiConfig } from "@/lib/ai/config";

let db: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const f = await createAiFixtureDb();
  db = f.db;
  cleanup = f.cleanup;
}, 90_000);
afterAll(async () => { await cleanup(); });

function cfg(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    ...loadAiConfig({ AI_ASSISTANT_ENABLED: "true", AI_API_KEY: "test" } as unknown as NodeJS.ProcessEnv),
    maxToolExecutions: 10,
    maxEvidenceRounds: 1,
    maxModelRounds: 6,
    toolTimeoutMs: 10_000,
    requestTimeoutMs: 30_000,
    ...overrides,
  };
}

/** A scripted model that replays a fixed list of protocol replies. */
function scripted(replies: string[], observe?: (messages: ModelMessage[], step: number) => void) {
  return new ScriptedModel((messages, step) => {
    observe?.(messages, step);
    return replies[Math.min(step, replies.length - 1)];
  });
}
const J = (o: unknown) => JSON.stringify(o);

describe("orchestrator", () => {
  it("runs the full Demo A chain and hydrates the answer from tool results", async () => {
    __resetConversations();
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", district: "Thủ Đức", limit: 3 }, statePatch: { sportSlug: "cau-long", district: "Thủ Đức", dateISO: SAT, durationHours: 2, budgetAmount: 400_000, budgetBasis: "total_session" } }),
      J({ kind: "tool_call", tool: "search_review_evidence", input: { venueIds: ["v_thuduc"], aspects: ["lighting"], limit: 6 } }),
      J({ kind: "tool_call", tool: "get_bookable_options", input: { venueId: "v_thuduc", date: SAT, durationHours: 2, budgetAmount: 400_000, budgetBasis: "total_session" } }),
      J({ kind: "final", answer: { type: "venue_shortlist", message: "Tìm thấy sân phù hợp, ánh sáng có cả ý kiến khen và chê.", venueIds: ["v_thuduc"], evidenceIds: ["gr_light_pos", "gr_light_neg"], optionIds: [], handoffId: null, missingFields: [] } }),
    ]);
    const res = await runAssistantTurn({ userMessage: "Tìm sân cầu lông ở Thủ Đức tối thứ Bảy, 2 tiếng, dưới 400 nghìn", model, db, cfg: cfg() });
    expect(res.answer.type).toBe("venue_shortlist");
    expect(res.answer.venues.map((v) => v.venueId)).toEqual(["v_thuduc"]);
    expect(res.answer.evidence.map((e) => e.evidenceId).sort()).toEqual(["gr_light_neg", "gr_light_pos"]);
    expect(res.answer.appliedContext.district).toBe("Thủ Đức");
    expect(res.trace.toolCalls.map((c) => c.tool)).toEqual(["search_venues", "search_review_evidence", "get_bookable_options"]);
    expect(res.trace.toolCalls[0].input).toMatchObject({ sportSlug: "cau-long", district: "Thủ Đức" });
    expect(res.trace.validation.answerValid).toBe(true);
    expect(res.trace.budgetUsed).toBe(3);
    expect(res.trace.promptVersion).toContain("v5");
  });

  it("rejects a hallucinated evidence id and falls back to a limited answer built from verified data", async () => {
    __resetConversations();
    const bad = J({ kind: "final", answer: { type: "review_insight", message: "Sân rất tốt [ev:gr_fake_123].", venueIds: [], evidenceIds: ["gr_fake_123"], optionIds: [], handoffId: null, missingFields: [] } });
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 3 } }),
      bad,
      bad, // still wrong after the repair instruction
    ]);
    const res = await runAssistantTurn({ userMessage: "Tìm sân cầu lông", model, db, cfg: cfg() });
    expect(res.answer.type).toBe("limited_answer");
    expect(res.trace.validation.fallbackUsed).toBe(true);
    expect(res.answer.message).not.toContain("gr_fake_123");
    expect(res.answer.venues.length).toBeGreaterThan(0); // built from the real search result
  });

  it("tool errors reach the model as errors — never as empty results", async () => {
    __resetConversations();
    let sawErrorCode: string | null = null;
    const model = scripted(
      [
        J({ kind: "tool_call", tool: "get_bookable_options", input: { venueId: "v_hidden", date: SAT, durationHours: 1 } }),
        J({ kind: "final", answer: { type: "limited_answer", message: "Chưa kiểm tra được lịch vì sân không công khai.", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] } }),
      ],
      (messages) => {
        const toolMsg = messages.find((m) => m.role === "tool");
        if (toolMsg && toolMsg.content.includes("NOT_PUBLIC")) sawErrorCode = "NOT_PUBLIC";
      },
    );
    const res = await runAssistantTurn({ userMessage: "Kiểm tra lịch sân ẩn", model, db, cfg: cfg() });
    expect(sawErrorCode).toBe("NOT_PUBLIC");
    expect(res.trace.toolCalls[0].errorCode).toBe("NOT_PUBLIC");
    expect(res.answer.type).toBe("limited_answer");
  });

  it("enforces the total tool budget across the whole turn", async () => {
    __resetConversations();
    let sawBudgetError = false;
    const call = J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 3 } });
    const model = scripted([call, call, call, call,
      J({ kind: "final", answer: { type: "venue_shortlist", message: "Đây là các sân tìm được.", venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] } }),
    ], (messages) => {
      if (messages.some((m) => m.role === "tool" && m.content.includes("BUDGET_EXHAUSTED"))) sawBudgetError = true;
    });
    const res = await runAssistantTurn({ userMessage: "Tìm sân", model, db, cfg: cfg({ maxToolExecutions: 2 }) });
    expect(res.trace.budgetUsed).toBe(2);
    expect(sawBudgetError).toBe(true);
    expect(res.answer.type).toBe("venue_shortlist");
  });

  it("caps supplementary evidence rounds (initial + configured extra)", async () => {
    __resetConversations();
    const ev = J({ kind: "tool_call", tool: "search_review_evidence", input: { venueIds: ["v_thuduc"], aspects: ["lighting"], limit: 4 } });
    const stats = J({ kind: "tool_call", tool: "get_review_summary_stats", input: { venueIds: ["v_thuduc"], source: "all" } });
    let refusals = 0;
    const model = scripted([ev, stats, ev,
      J({ kind: "final", answer: { type: "review_insight", message: "Đã có bằng chứng ánh sáng hai phía.", venueIds: [], evidenceIds: ["gr_light_pos"], optionIds: [], handoffId: null, missingFields: [] } }),
    ], (messages) => {
      refusals = messages.filter((m) => m.role === "tool" && m.content.includes("BUDGET_EXHAUSTED")).length;
    });
    const res = await runAssistantTurn({ userMessage: "Sân có chói không?", model, db, cfg: cfg({ maxEvidenceRounds: 0 }) });
    // maxEvidenceRounds=0 → only ONE evidence execution allowed; the
    // stats call (2nd evidence tool) is refused with BUDGET_EXHAUSTED.
    expect(refusals).toBeGreaterThan(0);
    expect(res.trace.evidenceRoundsUsed).toBe(0);
  });

  it("new user information overrides older state slots", async () => {
    __resetConversations();
    const model = scripted([
      J({ kind: "final", statePatch: { district: "Thủ Đức", sportSlug: "cau-long" }, answer: { type: "clarification", message: "Bạn muốn chơi ngày nào?", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: ["dateISO"] } }),
      J({ kind: "final", statePatch: { district: "Quận 7" }, answer: { type: "clarification", message: "Đã đổi sang Quận 7. Bạn muốn chơi ngày nào?", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: ["dateISO"] } }),
    ]);
    const first = await runAssistantTurn({ userMessage: "Tìm sân cầu lông ở Thủ Đức", model, db, cfg: cfg() });
    const second = await runAssistantTurn({ conversationId: first.conversationId, userMessage: "Đổi sang Quận 7", model, db, cfg: cfg() });
    expect(second.answer.appliedContext.district).toBe("Quận 7");
    expect(second.answer.appliedContext.sportSlug).toBe("cau-long"); // untouched slots persist
  });

  it("handoff flow produces a card and still creates NO booking", async () => {
    __resetConversations();
    const bookingsBefore = await db.booking.count();
    const model = scripted([
      J({ kind: "tool_call", tool: "prepare_booking_handoff", input: { venueId: "v_thuduc", facilityId: "f_thuduc", date: SAT, startTime: "17:00", durationHours: 1 } }),
      // handoffId is deterministic given the selection + checkedAt minute; read it back from the tool message instead of guessing.
      J({ kind: "final", answer: { type: "limited_answer", message: "placeholder", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] } }),
    ]);
    // First pass: learn the handoff id from the trace-level tool result via a second scripted run is overkill —
    // instead assert on the tool directly through the orchestrator by letting the model echo it.
    const echoModel = new ScriptedModel((messages) => {
      const toolMsg = [...messages].reverse().find((m) => m.role === "tool");
      if (!toolMsg) {
        return J({ kind: "tool_call", tool: "prepare_booking_handoff", input: { venueId: "v_thuduc", facilityId: "f_thuduc", date: SAT, startTime: "17:00", durationHours: 1 } });
      }
      const env = JSON.parse(toolMsg.content) as { data: { handoffId: string } };
      return J({ kind: "final", answer: { type: "booking_handoff", message: "Đã chuẩn bị xong, bạn xác nhận trong trang đặt sân nhé.", venueIds: [], evidenceIds: [], optionIds: [], handoffId: env.data.handoffId, missingFields: [] } });
    });
    void model;
    const res = await runAssistantTurn({ userMessage: "Đặt sân này thứ Bảy 17:00, 1 tiếng", model: echoModel, db, cfg: cfg() });
    expect(res.answer.type).toBe("booking_handoff");
    expect(res.answer.handoff?.totalPrice).toBe(100_000);
    expect(res.answer.handoff?.bookingUrl).toContain("/venues/minh-khai-thu-duc?");
    expect(await db.booking.count()).toBe(bookingsBefore);
  });

  it("unknown conversation ids start fresh instead of leaking another conversation", async () => {
    __resetConversations();
    const model = scripted([
      J({ kind: "final", answer: { type: "clarification", message: "Bạn muốn chơi môn gì?", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: ["sportSlug"] } }),
    ]);
    const res = await runAssistantTurn({ conversationId: "123e4567-e89b-12d3-a456-426614174000", userMessage: "Xin chào", model, db, cfg: cfg() });
    expect(res.conversationId).not.toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(res.answer.appliedContext.venueIds).toEqual([]);
  });

  it("client-carried context rehydrates the conversation on a fresh instance (serverless)", async () => {    __resetConversations();
    const first = await runAssistantTurn({
      userMessage: "Tìm sân cầu lông ở Thủ Đức",
      model: scripted([
        J({ kind: "final", statePatch: { sportSlug: "cau-long", district: "Thủ Đức" }, answer: { type: "clarification", message: "Bạn muốn chơi ngày nào?", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: ["dateISO"] } }),
      ]),
      db, cfg: cfg(),
    });
    const carried = {
      state: first.answer.appliedContext,
      history: [
        { role: "user" as const, content: "Tìm sân cầu lông ở Thủ Đức" },
        { role: "assistant" as const, content: "[clarification] Bạn muốn chơi ngày nào?" },
      ],
    };
    __resetConversations(); // simulate landing on a different instance
    const second = await runAssistantTurn({
      conversationId: first.conversationId,
      userMessage: "Thứ Bảy này, 18 giờ",
      model: scripted([
        J({ kind: "final", answer: { type: "clarification", message: "Chơi mấy tiếng?", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: ["durationHours"] } }),
      ]),
      db, cfg: cfg(),
      clientContext: carried,
    });
    expect(second.conversationId).toBe(first.conversationId); // id survives the instance switch
    expect(second.answer.appliedContext.sportSlug).toBe("cau-long"); // slots rehydrated, not forgotten
    expect(second.answer.appliedContext.district).toBe("Thủ Đức");
  });

  it("the fallback answer keeps verified OPTIONS, and the context carries a date lookup table", async () => {
    __resetConversations();
    let sawDateTable = false;
    const bad = J({ kind: "final", answer: { type: "venue_shortlist", message: "Sân này [ev:gr_fake].", venueIds: ["v_thuduc"], evidenceIds: ["gr_fake"], optionIds: [], handoffId: null, missingFields: [] } });
    const model = scripted(
      [
        J({ kind: "tool_call", tool: "get_bookable_options", input: { venueId: "v_thuduc", date: SAT, durationHours: 1 } }),
        bad, bad, bad,
      ],
      (messages) => {
        if (messages.some((m) => m.content.includes("Bảng tra ngày"))) sawDateTable = true;
      },
    );
    const res = await runAssistantTurn({ userMessage: "Xem lịch sân Thủ Đức", model, db, cfg: cfg({ maxModelRounds: 4 }) });
    expect(sawDateTable).toBe(true);
    expect(res.answer.type).toBe("limited_answer");
    expect(res.trace.validation.fallbackUsed).toBe(true);
    expect(res.answer.options.length).toBeGreaterThan(0); // verified options survive the fallback
  });
});
