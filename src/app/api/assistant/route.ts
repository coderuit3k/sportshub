import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { aiAssistantLimiter, getClientIp, tooManyRequests } from "@/lib/rate-limit";
import { loadAiConfig, modelConfigured } from "@/lib/ai/config";
import { createModel } from "@/lib/ai/provider";
import { runAssistantTurn, type AssistantAnswer } from "@/lib/ai/orchestrator";

/**
 * POST /api/assistant — one conversational turn of the AI assistant.
 *
 * Public (no login needed): the tools behind it read public venue data
 * only, re-checking visibility on every call. Configuration failures
 * are explicit (503 + structured answer) — there is NO fake fallback
 * model pretending to be AI. Rate limited per user (when logged in) or
 * per IP, on top of the orchestrator's tool/token budgets.
 */
const schema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(2000),
  /** Client-carried conversation context (public search slots +
   * history summaries). Re-validated server-side; lets a fresh
   * serverless instance continue the conversation. */
  state: z.record(z.unknown()).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .max(24)
    .optional(),
});

function errorAnswer(message: string, warnings: string[] = []): AssistantAnswer {
  return {
    type: "error",
    message,
    venues: [],
    comparison: null,
    evidence: [],
    options: [],
    handoff: null,
    warnings,
    missingFields: [],
    appliedContext: {
      sportSlug: null, district: null, dateISO: null, startTime: null,
      durationHours: null, budgetAmount: null, budgetBasis: null,
      venueIds: [], criteria: [],
    },
  };
}

export async function POST(req: Request) {
  const cfg = loadAiConfig();
  if (!cfg.enabled) {
    return NextResponse.json(
      { answer: errorAnswer("Trợ lý AI đang tạm tắt. Bạn vẫn có thể tìm và đặt sân như bình thường ở mục Tìm sân.") },
      { status: 503 },
    );
  }
  if (!modelConfigured(cfg)) {
    return NextResponse.json(
      {
        answer: errorAnswer(
          cfg.providerKind === "bedrock"
            ? "Trợ lý AI chưa được cấu hình model AWS Bedrock. Các tính năng tìm sân, xem đánh giá và đặt sân vẫn hoạt động bình thường."
            : "Trợ lý AI chưa được cấu hình model (thiếu AI_API_KEY). Các tính năng tìm sân, xem đánh giá và đặt sân vẫn hoạt động bình thường.",
        ),
      },
      { status: 503 },
    );
  }

  const user = await getCurrentUser().catch(() => null);
  const gateKey = user ? `ai:user:${user.id}` : `ai:ip:${getClientIp(req)}`;
  const gate = await aiAssistantLimiter.consume(gateKey);
  if (!gate.allowed) return tooManyRequests(gate);

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  }

  const model = createModel(cfg);
  const result = await runAssistantTurn({
    conversationId: parsed.data.conversationId,
    userMessage: parsed.data.message,
    model,
    db: prisma,
    cfg,
    clientContext:
      parsed.data.state || parsed.data.history
        ? { state: parsed.data.state, history: parsed.data.history }
        : undefined,
  });
  return NextResponse.json(result);
}
