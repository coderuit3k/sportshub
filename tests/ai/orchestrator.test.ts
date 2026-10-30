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
    expect(res.trace.promptVersion).toContain("v10");
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

  it("requires an availability/price check before finalizing a complete-slot shortlist (slot-check guard)", async () => {
    __resetConversations();
    let sawGuard = false;
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", district: "Thủ Đức", limit: 3 }, statePatch: { sportSlug: "cau-long", district: "Thủ Đức", dateISO: SAT, startTime: "17:00", durationHours: 1, budgetAmount: 400_000, budgetBasis: "total_session" } }),
      // Model tries to finalize from search/reference prices alone…
      J({ kind: "final", answer: { type: "venue_shortlist", message: "Sân này có giá theo giờ phù hợp ngân sách.", venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] } }),
      // …the guard requires a real slot check, after which options exist…
      J({ kind: "tool_call", tool: "get_bookable_options", input: { venueId: "v_thuduc", date: SAT, durationHours: 1, preferredStartTime: "17:00" } }),
      // …and the model may still forget optionIds (auto-fill covers that).
      J({ kind: "final", answer: { type: "venue_shortlist", message: "Đã kiểm tra lịch và giá cho khung giờ đã chọn.", venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] } }),
    ], (messages) => {
      if (messages.some((m) => m.role === "user" && m.content.includes("chưa kiểm tra lịch/giá thành công"))) sawGuard = true;
    });
    const res = await runAssistantTurn({ userMessage: "Tìm sân cầu lông ở Thủ Đức thứ Bảy này lúc 17:00, chơi 1 tiếng, tổng dưới 400 nghìn", model, db, cfg: cfg() });
    expect(sawGuard).toBe(true);
    expect(res.trace.toolCalls.some((c) => c.tool === "get_bookable_options" && c.status === "ok")).toBe(true);
    expect(res.answer.type).toBe("venue_shortlist");
    expect(res.answer.options.length).toBeGreaterThan(0);
    expect(res.trace.validation.repaired).toBe(true);
  });

  it("auto-fills shortlist options the model forgot to reference (shortlist auto-fill)", async () => {
    __resetConversations();
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", district: "Thủ Đức", limit: 3 } }),
      J({ kind: "tool_call", tool: "get_bookable_options", input: { venueId: "v_thuduc", date: SAT, durationHours: 1, window: { from: "17:00", to: "19:00" } }, statePatch: { dateISO: SAT, startTime: "17:00" } }),
      // Model quotes the slot in prose but references NO optionIds.
      J({ kind: "final", answer: { type: "venue_shortlist", message: "Sân còn trống lúc 17:00, giá đã rõ trong thẻ.", venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] } }),
    ]);
    const res = await runAssistantTurn({ userMessage: "Thứ Bảy này sân Minh Khai Thủ Đức còn giờ nào từ 17:00, chơi 1 tiếng?", model, db, cfg: cfg() });
    expect(res.answer.type).toBe("venue_shortlist");
    expect(res.answer.options.length).toBeGreaterThan(0);
    expect(res.answer.options.every((o) => o.venueId === "v_thuduc")).toBe(true);
    expect(res.trace.validation.answerValid).toBe(true);
  });

  it("rejects review counts stated without a successful stats call (stats guard)", async () => {
    __resetConversations();
    let sawGuard = false;
    const model = scripted([
      // Model tries to answer the count from thin air first…
      J({ kind: "final", answer: { type: "review_insight", message: "Sân có 8 bài đánh giá nhắc tới giá cả.", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] } }),
      // …the guard pushes back, so it fetches real stats…
      J({ kind: "tool_call", tool: "get_review_summary_stats", input: { venueIds: ["v_thuduc"], source: "google" } }),
      // …and only then may it state numbers.
      J({ kind: "final", answer: { type: "review_insight", message: "Đã tra thống kê đánh giá từ dữ liệu thật của sân.", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] } }),
    ], (messages) => {
      if (messages.some((m) => m.role === "user" && m.content.includes("SỐ LƯỢNG đánh giá"))) sawGuard = true;
    });
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai có bao nhiêu bài đánh giá nhắc tới giá cả?", model, db, cfg: cfg() });
    expect(sawGuard).toBe(true);
    expect(res.trace.toolCalls.some((c) => c.tool === "get_review_summary_stats" && c.status === "ok")).toBe(true);
    expect(res.answer.type).toBe("review_insight");
    expect(res.trace.validation.repaired).toBe(true);
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

describe("orchestrator — grounding (audit A)", () => {
  it("accepts a registered citation whose ID contains digits (AI-022)", async () => {
    __resetConversations();
    const evidenceId = "cmvswtmb5000mjxnx3q1ja7yh";
    await db.googleReview.create({ data: {
      id: evidenceId, venueId: "v_thuduc", authorName: "Test", rating: 5,
      relativeTime: "1 tháng trước", text: "Ánh sáng tốt và dễ nhìn cầu.",
    } });
    try {
      const model = scripted([
        J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 3 } }),
        J({ kind: "tool_call", tool: "search_review_evidence", input: { venueIds: ["v_thuduc"], aspects: ["lighting"], limit: 12 } }),
        J({ kind: "final", answer: { type: "review_insight", message: `Ánh sáng tốt [ev:${evidenceId}].`,
          venueIds: ["v_thuduc"], evidenceIds: [evidenceId], optionIds: [], handoffId: null, missingFields: [] } }),
      ]);
      const res = await runAssistantTurn({ userMessage: "Sân Minh Khai sáng không?", model, db, cfg: cfg({ maxModelRounds: 4 }) });
      expect(res.trace.validation.answerValid).toBe(true);
      expect(res.trace.validation.referencesValid).toBe(true);
      expect(res.trace.validation.grounding.status).toBe("passed");
      expect(res.answer.evidence.map((e) => e.evidenceId)).toContain(evidenceId);
    } finally {
      await db.googleReview.delete({ where: { id: evidenceId } });
    }
  });

  it("still rejects an invented digit-bearing citation as an unknown reference", async () => {
    __resetConversations();
    const fakeId = "cmvswtmb5000mjxnx3q1ja7yh_fake";
    const bad = J({ kind: "final", answer: { type: "review_insight", message: `Ánh sáng tốt [ev:${fakeId}].`,
      venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] } });
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 3 } }),
      J({ kind: "tool_call", tool: "search_review_evidence", input: { venueIds: ["v_thuduc"], aspects: ["lighting"], limit: 6 } }),
      bad, bad,
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai sáng không?", model, db, cfg: cfg({ maxModelRounds: 4 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.referencesValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain(`unknown evidence ${fakeId}`);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).not.toContain("số 5000");
  });

  it("still checks a factual number next to a valid citation", async () => {
    __resetConversations();
    const bad = J({ kind: "final", answer: { type: "review_insight", message: "Ánh sáng tốt [ev:gr_light_pos], giá 5000 đồng.",
      venueIds: ["v_thuduc"], evidenceIds: ["gr_light_pos"], optionIds: [], handoffId: null, missingFields: [] } });
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 3 } }),
      J({ kind: "tool_call", tool: "search_review_evidence", input: { venueIds: ["v_thuduc"], aspects: ["lighting"], limit: 6 } }),
      bad, bad,
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai sáng không?", model, db, cfg: cfg({ maxModelRounds: 4 }) });
    expect(res.trace.validation.referencesValid).toBe(true);
    expect(res.trace.validation.grounding.status).toBe("failed");
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("số 5000");
  });

  it("blocks a fabricated price/count next to a VALID evidence id", async () => {
    __resetConversations();
    const bad = J({
      kind: "final",
      answer: {
        type: "review_insight",
        message: "Ánh sáng tốt [ev:gr_light_pos]. Giá chính thức chỉ 1 đồng/giờ và sân có 999 sân con.",
        venueIds: ["v_thuduc"], evidenceIds: ["gr_light_pos"], optionIds: [], handoffId: null, missingFields: [],
      },
    });
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 3 } }),
      J({ kind: "tool_call", tool: "search_review_evidence", input: { venueIds: ["v_thuduc"], aspects: ["lighting"], limit: 6 } }),
      bad,
      bad,
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai ánh sáng thế nào, giá bao nhiêu?", model, db, cfg: cfg() });
    expect(res.answer.type).toBe("limited_answer");
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.referencesValid).toBe(true); // the ID was real — references are not grounding
    expect(res.trace.validation.grounding.status).toBe("failed");
    expect(res.trace.validation.grounding.problems.join(" ")).toMatch(/999|chính thức/);
    expect(res.answer.message).not.toContain("999");
    // v8: the rejection is attributable from the trace alone.
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toMatch(/999|chính thức/);
    expect(res.trace.validation.lastRejection?.message).toContain("999");
  });

  it("accepts a threshold number the USER stated (v8 regression: real-model 'số 4' fallbacks)", async () => {
    __resetConversations();
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", district: "Thủ Đức", limit: 5 } }),
      J({
        kind: "final",
        answer: {
          type: "venue_shortlist",
          // "3" appears in NO tool fact here (ratings 4.6/4.0, counts
          // 1200/80, 1 venue listed) — only in the user's own request.
          message: "Các sân cầu lông ở Thủ Đức có điểm Google từ 3 trở lên, nổi bật là Minh Khai với 4,6 điểm.",
          venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [],
        },
      }),
    ]);
    const res = await runAssistantTurn({ userMessage: "Tìm sân cầu lông ở Thủ Đức điểm từ 3 trở lên", model, db, cfg: cfg() });
    expect(res.answer.type).toBe("venue_shortlist");
    expect(res.trace.validation.answerValid).toBe(true);
    expect(res.trace.validation.grounding.status).toBe("passed");
  });

  it("accepts the search result COUNT as a prose fact (v8)", async () => {
    __resetConversations();
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 5 } }),
      J({
        kind: "final",
        answer: {
          type: "venue_shortlist",
          // 3 matched venues exist but only 1 is listed, so "3" can
          // only be grounded by totalMatched / returned-count facts.
          message: "Tìm thấy 3 sân cầu lông phù hợp; gợi ý đầu tiên là Minh Khai Thủ Đức với 4,6 điểm.",
          venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [],
        },
      }),
    ]);
    const res = await runAssistantTurn({ userMessage: "Tìm sân cầu lông", model, db, cfg: cfg() });
    expect(res.answer.type).toBe("venue_shortlist");
    expect(res.trace.validation.answerValid).toBe(true);
    expect(res.trace.validation.grounding.status).toBe("passed");
  });

  it("accepts a rating written as '4.6/5' (v9 regression: the dd/mm stripper must not eat the fraction tail)", async () => {
    __resetConversations();
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 5 } }),
      J({
        kind: "final",
        answer: {
          type: "venue_shortlist",
          // The exact shape the real model produced in AI-005/AI-017:
          // "4.6/5" — v8 stripped "6/5" as a dd/mm date and rejected
          // the leftover integer "4" as ungrounded, 7 repairs in a row.
          message: "Sân Minh Khai Thủ Đức đạt 4.6/5 điểm Google (1200 đánh giá).",
          venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [],
        },
      }),
    ]);
    const res = await runAssistantTurn({ userMessage: "Tìm sân cầu lông ở Thủ Đức", model, db, cfg: cfg() });
    expect(res.answer.type).toBe("venue_shortlist");
    expect(res.trace.validation.answerValid).toBe(true);
    expect(res.trace.validation.grounding.status).toBe("passed");
  });

  it("allows a truthful DENIAL of official/owner-confirmed pricing (v8: negation-aware provenance)", async () => {
    __resetConversations();
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 3 } }),
      J({ kind: "tool_call", tool: "get_bookable_options", input: { venueId: "v_thuduc", date: SAT, preferredStartTime: "17:00", durationHours: 1 } }),
      J({
        kind: "final",
        answer: {
          type: "venue_shortlist",
          message: "Sân Minh Khai còn trống lúc 17:00, tổng giá 100.000 đồng cho 1 giờ. Đây không phải giá chính thức và giá chưa được chủ sân xác nhận — chỉ là giá tham chiếu của nền tảng.",
          venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [`opt_f_thuduc_${SAT}_1700_1h`], handoffId: null, missingFields: [],
        },
      }),
    ]);
    const res = await runAssistantTurn({ userMessage: "Tìm sân cầu lông", model, db, cfg: cfg() });
    expect(res.answer.type).toBe("venue_shortlist");
    expect(res.trace.validation.answerValid).toBe(true);
    expect(res.trace.validation.grounding.status).toBe("passed");
  });

  it("nudges a tool-less shortlist to search first instead of falling back (v8 search guard, case AI-011)", async () => {
    __resetConversations();
    const emptyShortlist = J({
      kind: "final",
      answer: {
        type: "venue_shortlist",
        message: "Đây là các sân cầu lông điểm từ 4 trở lên.",
        venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [],
      },
    });
    const model = scripted([
      emptyShortlist,
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", minRating: 4, limit: 5 } }),
      J({
        kind: "final",
        answer: {
          type: "venue_shortlist",
          message: "Tìm thấy 3 sân cầu lông có điểm Google từ 4 trở lên; cao nhất là Minh Khai Thủ Đức với 4,6 điểm.",
          venueIds: ["v_thuduc", "v_quan7", "v_linhxuan"], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [],
        },
      }),
    ]);
    const res = await runAssistantTurn({ userMessage: "Tìm sân cầu lông điểm từ 4 trở lên", model, db, cfg: cfg() });
    expect(res.answer.type).toBe("venue_shortlist");
    expect(res.trace.validation.answerValid).toBe(true);
    expect(res.trace.toolCalls.some((c) => c.tool === "search_venues" && c.status === "ok")).toBe(true);
    expect(res.trace.validation.repairCount).toBeGreaterThanOrEqual(1);
  });

  it("nudges a tool-less clarification on a named-venue comparison to search + compare (compare guard, case AI-024)", async () => {
    __resetConversations();
    const model = scripted([
      J({
        kind: "final",
        statePatch: { dateISO: SAT, startTime: "17:00", durationHours: 1 },
        answer: {
          type: "clarification",
          message: "Bạn chơi môn gì và ngân sách bao nhiêu?",
          venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: ["sportSlug", "budgetAmount"],
        },
      }),
      J({ kind: "tool_call", tool: "search_venues", input: { query: "minh khai", limit: 5 } }),
      J({ kind: "tool_call", tool: "compare_venue_options", input: { venueIds: ["v_thuduc", "v_quan7"], criteria: [], date: SAT, startTime: "17:00", durationHours: 1 } }),
      J({
        kind: "final",
        answer: {
          type: "venue_comparison",
          message: "So sánh cùng điều kiện như sau.",
          venueIds: ["v_thuduc", "v_quan7"], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [],
        },
      }),
    ]);
    const res = await runAssistantTurn({
      userMessage: "So sánh sân Minh Khai Thủ Đức và Quận 7 tối thứ Bảy 17:00, 1 tiếng",
      model, db, cfg: cfg(),
    });
    expect(res.answer.type).toBe("venue_comparison");
    expect(res.trace.validation.answerValid).toBe(true);
    expect(res.trace.toolCalls.some((c) => c.tool === "compare_venue_options" && c.status === "ok")).toBe(true);
    expect(res.trace.validation.repairCount).toBeGreaterThanOrEqual(1);
  });

  it("accepts a final whose numbers all come from tool facts", async () => {
    __resetConversations();
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 3 } }),
      J({ kind: "tool_call", tool: "get_bookable_options", input: { venueId: "v_thuduc", date: SAT, preferredStartTime: "17:00", durationHours: 1 } }),
      J({
        kind: "final",
        answer: {
          type: "venue_shortlist",
          message: "Sân Minh Khai còn trống lúc 17:00, tổng giá 100.000 đồng cho 1 giờ (giá tham chiếu của nền tảng).",
          venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [`opt_f_thuduc_${SAT}_1700_1h`], handoffId: null, missingFields: [],
        },
      }),
    ]);
    const res = await runAssistantTurn({ userMessage: "Tìm sân cầu lông", model, db, cfg: cfg() });
    expect(res.answer.type).toBe("venue_shortlist");
    expect(res.trace.validation.answerValid).toBe(true);
    expect(res.trace.validation.grounding.status).toBe("passed");
    expect(res.trace.validation.referencesValid).toBe(true);
    expect(res.trace.validation.schemaValid).toBe(true);
    expect(res.trace.validation.firstAttemptToolSuccess).toBe(true);
  });

  it("blocks evidence of venue A used to conclude about venue B", async () => {
    __resetConversations();
    const bad = J({
      kind: "final",
      answer: {
        type: "review_insight",
        message: "Sân này ánh sáng tốt [ev:gr_light_pos].",
        venueIds: ["v_quan7"], evidenceIds: ["gr_light_pos"], optionIds: [], handoffId: null, missingFields: [],
      },
    });
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", district: "Quận 7", limit: 3 } }),
      J({ kind: "tool_call", tool: "search_review_evidence", input: { venueIds: ["v_thuduc"], aspects: ["lighting"], limit: 6 } }),
      bad,
      bad,
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân ở Quận 7 ánh sáng thế nào?", model, db, cfg: cfg() });
    expect(res.answer.type).toBe("limited_answer");
    expect(res.trace.validation.grounding.status).toBe("failed");
    expect(res.trace.validation.grounding.problems.join(" ")).toMatch(/sân khác/);
  });

  it("blocks a cleanliness claim supported only by a staff/court review", async () => {
    __resetConversations();
    const bad = J({
      kind: "final",
      answer: {
        type: "review_insight",
        message: "Vệ sinh rất sạch [ev:gr_pairing].",
        venueIds: ["v_thuduc"], evidenceIds: ["gr_pairing"], optionIds: [], handoffId: null, missingFields: [],
      },
    });
    const model = scripted([
      J({ kind: "tool_call", tool: "search_review_evidence", input: { venueIds: ["v_thuduc"], aspects: ["staff"], limit: 6 } }),
      bad,
      bad,
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai có sạch không?", model, db, cfg: cfg() });
    expect(res.answer.type).toBe("limited_answer");
    expect(res.trace.validation.grounding.status).toBe("failed");
  });
});

describe("orchestrator — operating hours grounding (AI-039)", () => {
  const hoursAnswer = (message: string, venueIds: string[] = []) => J({
    kind: "final", answer: { type: "limited_answer", message, venueIds,
      evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] },
  });

  it("rejects exact opening hours when no profile was checked", async () => {
    __resetConversations();
    const bad = hoursAnswer("Sân Minh Khai Thủ Đức mở cửa từ 06:00 đến 22:00 hàng ngày.");
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức mở cửa mấy giờ?",
      model: scripted([bad, bad]), db, cfg: cfg({ maxModelRounds: 2 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.fallbackUsed).toBe(true);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("giờ mở cửa");
  });

  it("accepts the hours returned by the profile for the named venue", async () => {
    __resetConversations();
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { query: "Minh Khai", district: "Thủ Đức", limit: 5 } }),
      J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } }),
      hoursAnswer("Sân Minh Khai Thủ Đức mở cửa 06:00–22:00 hàng ngày; giờ được chuẩn hóa từ Google.", ["v_thuduc"]),
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức mở cửa mấy giờ?", model, db, cfg: cfg() });
    expect(res.trace.validation.answerValid).toBe(true);
    expect(res.trace.validation.grounding.status).toBe("passed");
    expect(res.trace.toolCalls.map((call) => call.tool)).toEqual(["search_venues", "get_venue_profile"]);
    expect(res.answer.warnings.join(" ")).toContain("giờ mở cửa được chuẩn hoá");
  });

  it("accepts a limited hours answer from a directly fetched profile", async () => {
    __resetConversations();
    const model = scripted([
      J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } }),
      hoursAnswer("Sân Minh Khai (12 Võ Văn Ngân, Thủ Đức) mở cửa 06:00–22:00 hàng ngày.", ["v_thuduc"]),
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức mở cửa mấy giờ?", model, db, cfg: cfg() });
    expect(res.trace.validation.answerValid).toBe(true);
    expect(res.trace.toolCalls.map((call) => call.tool)).toEqual(["get_venue_profile"]);
  });

  it("does not borrow an address number from another venue", async () => {
    __resetConversations();
    const bad = hoursAnswer("Sân Minh Khai Thủ Đức (99 Nguyễn Thị Thập) mở cửa 06:00–22:00 hàng ngày.", ["v_thuduc"]);
    const model = scripted([
      J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } }),
      bad, bad,
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức mở cửa mấy giờ?", model, db,
      cfg: cfg({ maxModelRounds: 3 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("số 99");
  });

  it("rejects hours for a different venue named in prose despite a valid structural ID", async () => {
    __resetConversations();
    const bad = hoursAnswer("Sân Minh Khai Quận 7 mở cửa 06:00–22:00 hàng ngày.", ["v_thuduc"]);
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 5 } }),
      J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } }),
      bad, bad,
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Quận 7 mở cửa mấy giờ?", model, db,
      cfg: cfg({ maxModelRounds: 4 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("sân khác");
  });

  it("rejects another known venue name even when no district is stated", async () => {
    __resetConversations();
    const bad = hoursAnswer("Sân Cầu Lông Linh Xuân mở cửa 06:00–22:00 hàng ngày.", ["v_thuduc"]);
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 5 } }),
      J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } }),
      bad, bad,
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân Linh Xuân mở cửa mấy giờ?", model, db,
      cfg: cfg({ maxModelRounds: 4 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("sân khác");
  });

  it("accepts a verified venue with an empty district when its profile identifies the area", async () => {
    __resetConversations();
    const model = scripted([
      J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_linhxuan" } }),
      hoursAnswer("Sân Cầu Lông Linh Xuân Thủ Đức mở cửa 06:00–22:00 hàng ngày.", ["v_linhxuan"]),
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân Linh Xuân Thủ Đức mở cửa mấy giờ?", model, db, cfg: cfg() });
    expect(res.trace.validation.answerValid).toBe(true);
  });

  it("rejects an English opening-hours claim without a profile", async () => {
    __resetConversations();
    const bad = hoursAnswer("Sân Minh Khai is open from 06:00 to 22:00 daily.");
    const res = await runAssistantTurn({ userMessage: "When is Minh Khai open?", db,
      model: scripted([bad, bad]), cfg: cfg({ maxModelRounds: 2 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("giờ mở cửa");
  });

  it("rejects hours that differ from the checked profile", async () => {
    __resetConversations();
    const bad = hoursAnswer("Sân Minh Khai Thủ Đức mở cửa 06:00–23:00 hàng ngày, đúng không?", ["v_thuduc"]);
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { query: "Minh Khai", district: "Thủ Đức", limit: 5 } }),
      J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } }),
      bad, bad,
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức mở cửa mấy giờ?", model, db, cfg: cfg({ maxModelRounds: 4 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("giờ mở cửa");
  });

  it("checks the claimed weekday instead of borrowing another day's hours", async () => {
    await db.operatingHour.updateMany({ where: { venueId: "v_thuduc", dayOfWeek: 6 },
      data: { openTime: "07:00", closeTime: "20:00" } });
    try {
      const run = (message: string) => runAssistantTurn({ userMessage: "Thứ Bảy sân Minh Khai Thủ Đức mở cửa mấy giờ?", db,
        model: scripted([
          J({ kind: "tool_call", tool: "search_venues", input: { query: "Minh Khai", district: "Thủ Đức", limit: 5 } }),
          J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } }),
          hoursAnswer(message, ["v_thuduc"]),
        ]), cfg: cfg() });
      __resetConversations();
      expect((await run("Sân Minh Khai Thủ Đức mở cửa 07:00–20:00 thứ Bảy.")).trace.validation.answerValid).toBe(true);
      __resetConversations();
      const wrong = await run("Sân Minh Khai Thủ Đức mở cửa 07:00–20:00 hàng ngày.");
      expect(wrong.trace.validation.answerValid).toBe(false);
      expect(wrong.trace.validation.lastRejection?.problems.join(" ")).toContain("giờ mở cửa");
    } finally {
      await db.operatingHour.updateMany({ where: { venueId: "v_thuduc", dayOfWeek: 6 },
        data: { openTime: "06:00", closeTime: "22:00" } });
    }
  });

  it("does not validate a Monday–Friday range using Monday alone", async () => {
    await db.operatingHour.updateMany({ where: { venueId: "v_thuduc", dayOfWeek: 5 }, data: { closeTime: "20:00" } });
    try {
      __resetConversations();
      const bad = hoursAnswer("Sân Minh Khai Thủ Đức mở cửa 06:00–22:00 từ thứ Hai đến thứ Sáu.", ["v_thuduc"]);
      const model = scripted([
        J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } }),
        bad, bad,
      ]);
      const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức mở cửa từ thứ Hai đến thứ Sáu mấy giờ?",
        model, db, cfg: cfg({ maxModelRounds: 3 }) });
      expect(res.trace.validation.answerValid).toBe(false);
      expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("nhiều ngày");
    } finally {
      await db.operatingHour.updateMany({ where: { venueId: "v_thuduc", dayOfWeek: 5 }, data: { closeTime: "22:00" } });
    }
  });

  it("checks all seven days when the claim says daily despite naming Saturday", async () => {
    await db.operatingHour.updateMany({ where: { venueId: "v_thuduc", dayOfWeek: 6 },
      data: { openTime: "07:00", closeTime: "20:00" } });
    try {
      __resetConversations();
      const bad = hoursAnswer("Sân Minh Khai Thủ Đức mở cửa 07:00–20:00 hàng ngày, kể cả thứ Bảy.", ["v_thuduc"]);
      const model = scripted([
        J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } }),
        bad, bad,
      ]);
      const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức mở cửa hàng ngày mấy giờ?",
        model, db, cfg: cfg({ maxModelRounds: 3 }) });
      expect(res.trace.validation.answerValid).toBe(false);
      expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("giờ mở cửa");
    } finally {
      await db.operatingHour.updateMany({ where: { venueId: "v_thuduc", dayOfWeek: 6 },
        data: { openTime: "06:00", closeTime: "22:00" } });
    }
  });

  it("accepts a separate imported-hours provenance caveat after verified hours", async () => {
    __resetConversations();
    const model = scripted([
      J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } }),
      hoursAnswer("Sân Minh Khai Thủ Đức mở cửa 06:00–22:00 hàng ngày. Giờ mở cửa được chuẩn hoá từ Google và có thể khác thực tế.", ["v_thuduc"]),
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức mở cửa mấy giờ?", model, db, cfg: cfg() });
    expect(res.trace.validation.answerValid).toBe(true);
  });

  it("does not let an imported-hours caveat hide an all-day claim", async () => {
    __resetConversations();
    const bad = hoursAnswer("Giờ mở cửa được chuẩn hoá từ Google, sân mở cửa cả ngày.", ["v_thuduc"]);
    const model = scripted([
      J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } }),
      bad, bad,
    ]);
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức mở cửa mấy giờ?", model, db,
      cfg: cfg({ maxModelRounds: 3 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("giờ mở cửa");
  });

  it("does not reuse another venue's profile after the user changes venue", async () => {
    __resetConversations();
    const first = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức mở cửa mấy giờ?", db, cfg: cfg(), model: scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 5 } }),
      J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } }),
      J({ kind: "final", statePatch: { venueIds: ["v_thuduc"] }, answer: {
        type: "limited_answer", message: "Sân Minh Khai Thủ Đức mở cửa 06:00–22:00 hàng ngày.",
        venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [],
      } }),
    ]) });
    expect(first.trace.validation.answerValid).toBe(true);
    const bad = J({ kind: "final", statePatch: { venueIds: ["v_quan7"] }, answer: {
      type: "limited_answer", message: "Sân Minh Khai Quận 7 mở cửa 06:00–22:00 hàng ngày.",
      venueIds: ["v_quan7"], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [],
    } });
    const second = await runAssistantTurn({ conversationId: first.conversationId,
      userMessage: "Còn sân Minh Khai Quận 7 mở cửa mấy giờ?", model: scripted([bad, bad]), db,
      cfg: cfg({ maxModelRounds: 2 }) });
    expect(second.trace.validation.answerValid).toBe(false);
    expect(second.trace.validation.lastRejection?.problems.join(" ")).toContain("giờ mở cửa");
  });

  it("does not reuse a profile from an earlier turn even for the same venue", async () => {
    __resetConversations();
    const answer = hoursAnswer("Sân Minh Khai Thủ Đức mở cửa 06:00–22:00 hàng ngày.", ["v_thuduc"]);
    const first = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức mở cửa mấy giờ?", db, cfg: cfg(),
      model: scripted([
        J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } }),
        answer,
      ]) });
    expect(first.trace.validation.answerValid).toBe(true);
    const second = await runAssistantTurn({ conversationId: first.conversationId,
      userMessage: "Giờ mở cửa sân đó vẫn vậy chứ?", db, cfg: cfg({ maxModelRounds: 2 }),
      model: scripted([answer, answer]) });
    expect(second.trace.validation.answerValid).toBe(false);
    expect(second.trace.validation.lastRejection?.problems.join(" ")).toContain("giờ mở cửa");
  });

  it("allows an honest unknown-hours answer without a profile", async () => {
    __resetConversations();
    const res = await runAssistantTurn({ userMessage: "Sân này mở cửa mấy giờ?", db,
      model: scripted([hoursAnswer("Tôi chưa kiểm tra được giờ mở cửa của sân này.")]), cfg: cfg() });
    expect(res.trace.validation.answerValid).toBe(true);
  });

  it("allows an honest unverified-hours answer without a profile", async () => {
    __resetConversations();
    const res = await runAssistantTurn({ userMessage: "Sân này mở cửa mấy giờ?", db,
      model: scripted([hoursAnswer("Giờ mở cửa chưa được xác minh.")]), cfg: cfg() });
    expect(res.trace.validation.answerValid).toBe(true);
  });

  it("does not let an uncertainty phrase hide a factual hours claim", async () => {
    __resetConversations();
    const bad = hoursAnswer("Tôi chưa kiểm tra giờ mở cửa, nhưng sân mở cửa cả ngày.");
    const res = await runAssistantTurn({ userMessage: "Sân này mở cửa mấy giờ?", db,
      model: scripted([bad, bad]), cfg: cfg({ maxModelRounds: 2 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("giờ mở cửa");
  });

  it("allows a question asking which venue's hours to check", async () => {
    __resetConversations();
    const res = await runAssistantTurn({ userMessage: "Tôi muốn biết giờ mở cửa.", db,
      model: scripted([hoursAnswer("Bạn muốn hỏi giờ mở cửa của sân nào?")]), cfg: cfg() });
    expect(res.trace.validation.answerValid).toBe(true);
  });
});

describe("orchestrator — cancellation policy grounding (AI-040)", () => {
  const answer = (message: string, venueIds: string[] = ["v_thuduc"]) => J({
    kind: "final", answer: { type: "limited_answer", message, venueIds,
      evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] },
  });
  const profile = J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_thuduc" } });

  it("routes a named policy question to a profile after an unsupported unknown answer", async () => {
    __resetConversations();
    const model = scripted([
      answer("Tôi chưa kiểm tra được chính sách hủy của sân Minh Khai Thủ Đức.", []),
      J({ kind: "tool_call", tool: "search_venues", input: { query: "Minh Khai", district: "Thủ Đức", limit: 5 } }),
      profile,
      answer("Hoàn toàn bộ nếu hủy trước 12 giờ; trước 4 giờ chịu phí 30% (chính sách tham chiếu của nền tảng)."),
    ]);
    const res = await runAssistantTurn({ userMessage: "Chính sách huỷ của sân Minh Khai Thủ Đức?", model, db, cfg: cfg() });
    expect(res.trace.validation.answerValid).toBe(true);
    expect(res.trace.toolCalls.map((call) => call.tool)).toEqual(["search_venues", "get_venue_profile"]);
  });

  it("routes a named-venue cancellation-fee question to the profile", async () => {
    __resetConversations();
    const model = scripted([
      answer("Tôi chưa kiểm tra được phí hủy của sân Minh Khai Thủ Đức.", []),
      J({ kind: "tool_call", tool: "search_venues", input: { query: "Minh Khai", district: "Thủ Đức", limit: 5 } }),
      profile,
      answer("Sân Minh Khai Thủ Đức hủy trước 4 giờ chịu phí 30%."),
    ]);
    const res = await runAssistantTurn({ userMessage: "Phí hủy của sân Minh Khai Thủ Đức?", model, db, cfg: cfg() });
    expect(res.trace.validation.answerValid).toBe(true);
    expect(res.trace.toolCalls.map((call) => call.tool)).toEqual(["search_venues", "get_venue_profile"]);
  });

  it("rejects policy numbers copied from the user without checking a profile", async () => {
    __resetConversations();
    const bad = answer("Sân Minh Khai Thủ Đức hoàn toàn bộ nếu hủy trước 12 giờ; trước 4 giờ chịu phí 30%.");
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức hoàn tiền trước 12 giờ, 4 giờ và phí 30% đúng không?",
      model: scripted([bad, bad]), db, cfg: cfg({ maxModelRounds: 2 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("chính sách hủy cần");
  });

  it("accepts profile thresholds and fee, including two clauses in one sentence", async () => {
    __resetConversations();
    const res = await runAssistantTurn({ userMessage: "Chính sách hủy của sân Minh Khai Thủ Đức?", db, cfg: cfg(),
      model: scripted([profile, answer("Hủy trước 12 giờ được hoàn toàn bộ, và trước 4 giờ chịu phí 30% (chính sách tham chiếu của nền tảng).")]) });
    expect(res.trace.validation.answerValid).toBe(true);
  });

  it("accepts the real-model 100 percent refund and 30 percent fee wording", async () => {
    __resetConversations();
    const message = "Chính sách hủy của Sân Cầu Lông Minh Khai (Thủ Đức):\n" +
      "• Hoàn tiền 100% nếu hủy trước 12 giờ\n" +
      "• Hoàn tiền một phần nếu hủy trước 4 giờ (mất 30% phí)\n" +
      "• Không hoàn tiền nếu hủy trong vòng 4 giờ trước buổi chơi\n" +
      "(Đây là chính sách tham chiếu của nền tảng SportsHub; sân chưa có chủ sân xác nhận.)";
    const res = await runAssistantTurn({ userMessage: "Chính sách hủy của sân Minh Khai Thủ Đức?", db, cfg: cfg(),
      model: scripted([profile, answer(message)]) });
    expect(res.trace.validation.answerValid).toBe(true);
  });

  it("accepts the verified 4–12 hour window and under-4 cutoff in the live answer", async () => {
    __resetConversations();
    const message = "Chính sách hủy của Sân Cầu Lông Minh Khai (Thủ Đức): " +
      "• Hoàn tiền 100%: Hủy trước 12 giờ\n" +
      "• Hoàn tiền 70% (phí 30%): Hủy từ 4–12 giờ trước\n" +
      "• Không hoàn tiền: Hủy dưới 4 giờ trước. Đây là chính sách tham chiếu của nền tảng SportsHub.";
    const res = await runAssistantTurn({ userMessage: "Chính sách hủy của sân Minh Khai Thủ Đức?", db, cfg: cfg(),
      model: scripted([profile, answer(message)]) });
    expect(res.trace.validation.answerValid).toBe(true);
  });

  it("accepts a 70 percent refund inferred from the verified 30 percent fee", async () => {
    __resetConversations();
    const res = await runAssistantTurn({ userMessage: "Chính sách hủy của sân Minh Khai Thủ Đức?", db, cfg: cfg(),
      model: scripted([profile, answer("Hủy trước 4 giờ được hoàn 70%.")]) });
    expect(res.trace.validation.answerValid).toBe(true);
  });

  it("accepts two refund tiers joined by 'hoặc'", async () => {
    __resetConversations();
    const res = await runAssistantTurn({ userMessage: "Chính sách hủy của sân Minh Khai Thủ Đức?", db, cfg: cfg(),
      model: scripted([profile, answer("Hoàn 100% nếu hủy trước 12 giờ hoặc hoàn 70% nếu hủy trước 4 giờ.")]) });
    expect(res.trace.validation.answerValid).toBe(true);
  });

  it("rejects full refund at the partial threshold", async () => {
    __resetConversations();
    const bad = answer("Sân Minh Khai Thủ Đức hoàn toàn bộ nếu hủy trước 4 giờ.");
    const res = await runAssistantTurn({ userMessage: "Chính sách hủy của sân Minh Khai Thủ Đức?", db,
      model: scripted([profile, bad, bad]), cfg: cfg({ maxModelRounds: 3 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("ngưỡng hoàn toàn bộ");
  });

  it("rejects a fee copied from the user's question", async () => {
    __resetConversations();
    const bad = answer("Sân Minh Khai Thủ Đức hủy trước 4 giờ chịu phí 20%.");
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức hủy trước 4 giờ chịu phí 20% đúng không?", db,
      model: scripted([profile, bad, bad]), cfg: cfg({ maxModelRounds: 3 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("phí hủy");
  });

  it("checks a bare fee percentage in an answer about cancellation", async () => {
    __resetConversations();
    const bad = answer("Phí 20%.");
    const res = await runAssistantTurn({ userMessage: "Chính sách hủy của sân Minh Khai Thủ Đức có phí 20% đúng không?", db,
      model: scripted([profile, bad, bad]), cfg: cfg({ maxModelRounds: 3 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("phí hủy");
  });

  it("rejects a wrong partial-refund window even when the user supplied its number", async () => {
    __resetConversations();
    const bad = answer("Hoàn tiền 70% (phí 30%) nếu hủy từ 5–12 giờ trước.");
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức hoàn 70% từ 5–12 giờ trước đúng không?", db,
      model: scripted([profile, bad, bad]), cfg: cfg({ maxModelRounds: 3 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("khoảng hoàn một phần");
  });

  it("rejects a wrong no-refund cutoff even when its number is in the question", async () => {
    __resetConversations();
    const bad = answer("Không hoàn tiền nếu hủy dưới 12 giờ trước.");
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức không hoàn tiền nếu hủy dưới 12 giờ trước đúng không?", db,
      model: scripted([profile, bad, bad]), cfg: cfg({ maxModelRounds: 3 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("ngưỡng không hoàn tiền");
  });

  it("rejects an incorrect no-refund cutoff phrased as within N hours", async () => {
    __resetConversations();
    const bad = answer("Không hoàn tiền nếu hủy trong vòng 12 giờ trước buổi chơi.");
    const res = await runAssistantTurn({ userMessage: "Sân Minh Khai Thủ Đức không hoàn tiền trong vòng 12 giờ đúng không?", db,
      model: scripted([profile, bad, bad]), cfg: cfg({ maxModelRounds: 3 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("ngưỡng không hoàn tiền");
  });

  it("rejects policy prose naming Quận 7 with the Thủ Đức profile ID", async () => {
    __resetConversations();
    const bad = answer("Sân Minh Khai Quận 7 hoàn toàn bộ nếu hủy trước 12 giờ.");
    const model = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 5 } }),
      profile, bad, bad,
    ]);
    const res = await runAssistantTurn({ userMessage: "Chính sách hủy sân Minh Khai Quận 7?", db,
      model, cfg: cfg({ maxModelRounds: 4 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("sân khác");
  });

  it("rejects owner verification for an imported policy", async () => {
    __resetConversations();
    const bad = answer("Chính sách hủy được chủ sân xác nhận: hoàn toàn bộ trước 12 giờ.");
    const res = await runAssistantTurn({ userMessage: "Chính sách hủy của sân Minh Khai Thủ Đức?", db,
      model: scripted([profile, bad, bad]), cfg: cfg({ maxModelRounds: 3 }) });
    expect(res.trace.validation.answerValid).toBe(false);
    expect(res.trace.validation.lastRejection?.problems.join(" ")).toContain("nguồn chính sách hủy");
  });

  it("accepts owner verification for an owner-managed policy", async () => {
    __resetConversations();
    const res = await runAssistantTurn({ userMessage: "Chính sách hủy của sân Bóng Rổ Phú Thọ?", db,
      model: scripted([
        J({ kind: "tool_call", tool: "get_venue_profile", input: { venueId: "v_owner" } }),
        answer("Chính sách hủy được chủ sân xác nhận: hoàn toàn bộ trước 12 giờ.", ["v_owner"]),
      ]), cfg: cfg() });
    expect(res.trace.validation.answerValid).toBe(true);
  });

  it("accepts policy values from a handoff rechecked in the current turn", async () => {
    __resetConversations();
    const handoff = J({ kind: "tool_call", tool: "prepare_booking_handoff",
      input: { venueId: "v_thuduc", facilityId: "f_thuduc", date: SAT, startTime: "17:00", durationHours: 1 } });
    const res = await runAssistantTurn({ userMessage: "Chuẩn bị đặt sân Minh Khai Thủ Đức 17:00 thứ Bảy, chính sách hủy thế nào?", db,
      model: scripted([handoff, answer("Hủy trước 12 giờ được hoàn toàn bộ; trước 4 giờ chịu phí 30%.")]), cfg: cfg() });
    expect(res.trace.toolCalls[0]).toMatchObject({ tool: "prepare_booking_handoff", status: "ok" });
    expect(res.trace.validation.answerValid).toBe(true);
  });

  it("does not render a handoff card from an earlier user turn", async () => {
    __resetConversations();
    let handoffId = "";
    const firstModel = new ScriptedModel((messages) => {
      const toolMessage = [...messages].reverse().find((m) => m.role === "tool");
      if (!toolMessage) return J({ kind: "tool_call", tool: "prepare_booking_handoff",
        input: { venueId: "v_thuduc", facilityId: "f_thuduc", date: SAT, startTime: "17:00", durationHours: 1 } });
      handoffId = (JSON.parse(toolMessage.content) as { data: { handoffId: string } }).data.handoffId;
      return J({ kind: "final", answer: { type: "booking_handoff", message: "Bạn xác nhận trên trang đặt sân.",
        venueIds: [], evidenceIds: [], optionIds: [], handoffId, missingFields: [] } });
    });
    const first = await runAssistantTurn({ userMessage: "Chuẩn bị đặt sân Minh Khai Thủ Đức 17:00 thứ Bảy", db,
      model: firstModel, cfg: cfg() });
    expect(first.trace.validation.answerValid).toBe(true);
    expect(first.answer.handoff?.handoffId).toBe(handoffId);
    const stale = J({ kind: "final", answer: { type: "booking_handoff", message: "Thẻ đặt sân vẫn còn hiệu lực.",
      venueIds: [], evidenceIds: [], optionIds: [], handoffId, missingFields: [] } });
    const second = await runAssistantTurn({ conversationId: first.conversationId, userMessage: "Vẫn đặt sân này nhé", db,
      model: scripted([stale, stale]), cfg: cfg({ maxModelRounds: 2 }) });
    expect(second.trace.validation.answerValid).toBe(false);
    expect(second.trace.validation.lastRejection?.problems.join(" ")).toContain("handoffId");
    expect(second.answer.handoff).toBeNull();
  });

  it("does not reuse a policy profile from an earlier user turn", async () => {
    __resetConversations();
    const claim = answer("Sân Minh Khai Thủ Đức hoàn toàn bộ nếu hủy trước 12 giờ.");
    const first = await runAssistantTurn({ userMessage: "Chính sách hủy của sân Minh Khai Thủ Đức?", db,
      model: scripted([profile, claim]), cfg: cfg() });
    expect(first.trace.validation.answerValid).toBe(true);
    const second = await runAssistantTurn({ conversationId: first.conversationId,
      userMessage: "Chính sách đó vẫn vậy chứ?", db, model: scripted([claim, claim]), cfg: cfg({ maxModelRounds: 2 }) });
    expect(second.trace.validation.answerValid).toBe(false);
    expect(second.trace.validation.lastRejection?.problems.join(" ")).toContain("chính sách hủy cần");
  });

  it("allows a question asking which venue's policy to check", async () => {
    __resetConversations();
    const res = await runAssistantTurn({ userMessage: "Chính sách hủy thế nào?", db, cfg: cfg(),
      model: scripted([answer("Bạn muốn hỏi chính sách hủy của sân nào?", [])]) });
    expect(res.trace.validation.answerValid).toBe(true);
    expect(res.trace.toolCalls).toHaveLength(0);
  });
});

describe("orchestrator — conversation ownership (audit B)", () => {
  it("another principal presenting the same conversationId sees a FRESH conversation", async () => {
    __resetConversations();
    const first = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", district: "Thủ Đức", limit: 3 }, statePatch: { sportSlug: "cau-long", district: "Thủ Đức" } }),
      J({ kind: "final", answer: { type: "clarification", message: "Bạn muốn chơi ngày nào?", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: ["dateISO"] } }),
    ]);
    const resA = await runAssistantTurn({ userMessage: "Tìm sân cầu lông Thủ Đức", model: first, db, cfg: cfg(), principal: "user:alice" });
    expect(resA.answer.appliedContext.district).toBe("Thủ Đức");

    let seenState = "";
    const second = scripted(
      [J({ kind: "final", answer: { type: "clarification", message: "Bạn muốn tìm sân nào?", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] } })],
      (messages) => { seenState = messages.map((m) => m.content).join("\n"); },
    );
    const resB = await runAssistantTurn({ conversationId: resA.conversationId, userMessage: "tiếp tục đi", model: second, db, cfg: cfg(), principal: "user:bob" });
    expect(resB.conversationId).not.toBe(resA.conversationId);
    expect(resB.answer.appliedContext.district).toBeNull();
    expect(seenState).not.toContain("Thủ Đức");
  });

  it("the owning principal keeps state across turns with the same id", async () => {
    __resetConversations();
    const first = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", district: "Thủ Đức", limit: 3 }, statePatch: { sportSlug: "cau-long", district: "Thủ Đức" } }),
      J({ kind: "final", answer: { type: "clarification", message: "Bạn muốn chơi ngày nào?", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: ["dateISO"] } }),
    ]);
    const resA = await runAssistantTurn({ userMessage: "Tìm sân cầu lông Thủ Đức", model: first, db, cfg: cfg(), principal: "anon:xyz" });
    const second = scripted([
      J({ kind: "final", answer: { type: "clarification", message: "Bạn muốn chơi mấy giờ?", venueIds: [], evidenceIds: [], optionIds: [], handoffId: null, missingFields: ["startTime"] } }),
    ]);
    const resB = await runAssistantTurn({ conversationId: resA.conversationId, userMessage: "thứ Bảy này", model: second, db, cfg: cfg(), principal: "anon:xyz" });
    expect(resB.conversationId).toBe(resA.conversationId);
    expect(resB.answer.appliedContext.district).toBe("Thủ Đức");
  });
});

describe("orchestrator — registry freshness (audit J)", () => {
  it("changing the start time invalidates options quoted for the old slot", async () => {
    __resetConversations();
    const optionId = `opt_f_thuduc_${SAT}_1700_1h`;
    const turn1 = scripted([
      J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 3 }, statePatch: { sportSlug: "cau-long", dateISO: SAT, startTime: "17:00", durationHours: 1 } }),
      J({ kind: "tool_call", tool: "get_bookable_options", input: { venueId: "v_thuduc", date: SAT, preferredStartTime: "17:00", durationHours: 1 } }),
      J({ kind: "final", answer: { type: "venue_shortlist", message: "Còn trống lúc 17:00.", venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [optionId], handoffId: null, missingFields: [] } }),
    ]);
    const res1 = await runAssistantTurn({ userMessage: "Tìm sân cầu lông thứ Bảy 17:00, 1 giờ", model: turn1, db, cfg: cfg() });
    expect(res1.answer.options.map((o) => o.optionId)).toEqual([optionId]);

    const stale = J({
      kind: "final", statePatch: { startTime: "20:00" },
      answer: { type: "venue_shortlist", message: "Đây là lựa chọn của bạn.", venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [optionId], handoffId: null, missingFields: [] },
    });
    const turn2 = scripted([stale, stale]);
    const res2 = await runAssistantTurn({ conversationId: res1.conversationId, userMessage: "Đổi sang 20:00 giúp tôi", model: turn2, db, cfg: cfg() });
    expect(res2.trace.validation.fallbackUsed).toBe(true);
    expect(res2.answer.options).toEqual([]);
  });
});

describe("orchestrator — evidence budget & trace completeness (audit D/J)", () => {
  it("an invalid-input evidence call does not consume the evidence round", async () => {
    __resetConversations();
    let sawBudgetRefusal = false;
    const model = scripted(
      [
        J({ kind: "tool_call", tool: "get_review_summary_stats", input: { venueIds: [] } }), // INVALID_INPUT
        J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 3 } }),
        J({ kind: "tool_call", tool: "get_review_summary_stats", input: { venueIds: ["v_thuduc"] } }),
        J({ kind: "tool_call", tool: "search_review_evidence", input: { venueIds: ["v_thuduc"], limit: 3 } }), // 2nd gathering → refused
        J({ kind: "final", answer: { type: "review_insight", message: "Mẫu Google đã lưu của sân Minh Khai có 5 bài đánh giá.", venueIds: ["v_thuduc"], evidenceIds: [], optionIds: [], handoffId: null, missingFields: [] } }),
      ],
      (messages) => {
        if (messages.some((m) => m.role === "tool" && m.content.includes("BUDGET_EXHAUSTED"))) sawBudgetRefusal = true;
      },
    );
    const res = await runAssistantTurn({ userMessage: "Có bao nhiêu review về sân Minh Khai?", model, db, cfg: cfg({ maxEvidenceRounds: 0 }) });
    expect(res.trace.toolCalls.map((c) => c.status)).toEqual(["error", "ok", "ok"]);
    expect(res.trace.toolCalls[0].errorCode).toBe("INVALID_INPUT");
    expect(res.trace.validation.firstAttemptToolSuccess).toBe(false);
    expect(res.trace.evidenceRoundsUsed).toBe(0);
    expect(sawBudgetRefusal).toBe(true);
    expect(res.answer.type).toBe("review_insight");
    expect(res.trace.validation.answerValid).toBe(true);
  });

  it("records tokens and cost on the provider-failure exit path", async () => {
    __resetConversations();
    let calls = 0;
    const flaky = {
      id: "flaky-test",
      complete: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            text: J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 3 } }),
            usage: { inputTokens: 1000, outputTokens: 50 },
          };
        }
        throw new Error("provider down");
      },
    };
    const res = await runAssistantTurn({ userMessage: "Tìm sân cầu lông", model: flaky, db, cfg: cfg() });
    expect(res.answer.type).toBe("limited_answer");
    expect(res.trace.validation.fallbackUsed).toBe(true);
    expect(res.trace.tokens).toEqual({ input: 1000, output: 50 });
    expect(res.trace.estimatedCostUsd).toBeCloseTo(0.00125, 8);
  });

  it("stops buying rounds when the per-turn token budget is spent", async () => {
    __resetConversations();
    const hungry = {
      id: "hungry-test",
      complete: async () => ({
        text: J({ kind: "tool_call", tool: "search_venues", input: { sportSlug: "cau-long", limit: 3 } }),
        usage: { inputTokens: 5000, outputTokens: 0 },
      }),
    };
    const res = await runAssistantTurn({ userMessage: "Tìm sân cầu lông", model: hungry, db, cfg: cfg({ maxTotalTokens: 100 }) });
    expect(res.answer.type).toBe("limited_answer");
    expect(res.trace.budgetOutcome).toBe("exhausted");
    expect(res.trace.tokens).toEqual({ input: 5000, output: 0 });
  });
});
