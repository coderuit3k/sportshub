"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Bot, ExternalLink, Send, Star, User } from "lucide-react";
import { formatVND } from "@/lib/booking/logic";
import type { AssistantAnswer } from "@/lib/ai/orchestrator";

/**
 * Chat UI for the AI assistant. It renders ONLY the structured answer
 * the server returned (validated + hydrated from tool results): venue
 * cards, comparison matrix, verbatim evidence, availability options
 * and the booking handoff card. Review text is rendered as React text
 * (escaped by construction) — never as HTML.
 */
interface Turn {
  role: "user" | "assistant";
  text?: string;
  answer?: AssistantAnswer;
}

const STATUS_KEYS = ["statusSearch", "statusReviews", "statusSchedule"] as const;

export default function AssistantChat({ available }: { available: boolean }) {
  const t = useTranslations("assistant");
  const locale = useLocale();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  /**
   * Conversation context carried by the client and returned with
   * every request: server instances are ephemeral (serverless), so
   * this is what lets a fresh instance continue the conversation
   * instead of forgetting the slots already collected. It mirrors
   * exactly what the server puts in `appliedContext` + the
   * user/assistant summaries the server itself keeps.
   */
  const contextRef = useRef<{
    state: AssistantAnswer["appliedContext"] | null;
    history: { role: "user" | "assistant"; content: string }[];
  }>({ state: null, history: [] });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  useEffect(() => {
    if (!busy) return;
    setStatusIdx(0);
    const id = setInterval(() => setStatusIdx((i) => Math.min(i + 1, STATUS_KEYS.length - 1)), 4000);
    return () => clearInterval(id);
  }, [busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setTurns((prev) => [...prev, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message,
          ...(contextRef.current.state
            ? { state: contextRef.current.state, history: contextRef.current.history }
            : {}),
        }),
      });
      const json = (await res.json()) as { conversationId?: string; answer?: AssistantAnswer };
      if (json.conversationId) setConversationId(json.conversationId);
      if (res.ok && json.answer) {
        contextRef.current = {
          state: json.answer.appliedContext,
          history: [
            ...contextRef.current.history,
            { role: "user" as const, content: message.slice(0, 2000) },
            { role: "assistant" as const, content: `[${json.answer.type}] ${json.answer.message}`.slice(0, 2000) },
          ].slice(-24),
        };
      }
      const answer: AssistantAnswer =
        json.answer ??
        ({
          type: "error",
          message: res.status === 429 ? "Bạn gửi hơi nhanh — chờ một chút rồi thử lại." : t("errorGeneric"),
          venues: [], comparison: null, evidence: [], options: [], handoff: null,
          warnings: [], missingFields: [],
          appliedContext: {
            sportSlug: null, district: null, dateISO: null, startTime: null, durationHours: null,
            budgetAmount: null, budgetBasis: null, venueIds: [], criteria: [],
          },
        } satisfies AssistantAnswer);
      setTurns((prev) => [...prev, { role: "assistant", answer }]);
    } catch {
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          answer: {
            type: "error", message: t("errorGeneric"), venues: [], comparison: null, evidence: [],
            options: [], handoff: null, warnings: [], missingFields: [],
            appliedContext: {
              sportSlug: null, district: null, dateISO: null, startTime: null, durationHours: null,
              budgetAmount: null, budgetBasis: null, venueIds: [], criteria: [],
            },
          },
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {!available && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{t("notConfigured")}</p>
      )}
      <div className="card flex min-h-[420px] flex-col gap-4 p-4 sm:p-5" aria-live="polite">
        {turns.length === 0 && (
          <div className="flex flex-col gap-3">
            <p className="flex items-start gap-2 text-sm leading-relaxed text-slate-700">
              <Bot className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> {t("greeting")}
            </p>
            <div className="flex flex-wrap gap-2">
              {[t("suggestion1"), t("suggestion2")].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-left text-xs font-medium text-primary hover:bg-primary/10"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <p key={i} className="flex items-start justify-end gap-2">
              <span className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-white">{turn.text}</span>
              <User className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
            </p>
          ) : (
            <div key={i} className="flex items-start gap-2">
              <Bot className="mt-1 h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 max-w-[92%] flex-1">
                <AnswerView answer={turn.answer!} locale={locale} t={t} />
              </div>
            </div>
          ),
        )}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Bot className="h-5 w-5 shrink-0 animate-pulse text-primary" /> {t(STATUS_KEYS[statusIdx])}
          </p>
        )}
        <div ref={bottomRef} />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label className="sr-only" htmlFor="assistant-input">{t("title")}</label>
        <input
          id="assistant-input"
          className="input flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("placeholder")}
          maxLength={2000}
          disabled={busy}
        />
        <button type="submit" className="btn-primary flex items-center gap-1.5 px-4" disabled={busy || !input.trim()}>
          <Send className="h-4 w-4" /> {busy ? t("sending") : t("send")}
        </button>
      </form>
    </div>
  );
}

function AnswerView({
  answer,
  locale,
  t,
}: {
  answer: AssistantAnswer;
  locale: string;
  t: ReturnType<typeof useTranslations<"assistant">>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p
        className={`whitespace-pre-line rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed ${
          answer.type === "error" ? "border border-red-200 bg-red-50 text-red-800" : "bg-slate-100 text-slate-800"
        }`}
      >
        {answer.message}
      </p>

      {answer.venues.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {answer.venues.map((v) => (
            <article key={v.venueId} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="font-semibold leading-tight text-slate-900">{v.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">{v.district} — {v.address}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-accent text-accent" />
                  <strong>{v.rating.value.toFixed(1)}</strong>
                  <span className="text-xs text-slate-500">
                    ({v.rating.count ?? 0}) · {v.rating.source === "google" ? t("googleSource") : t("inAppSource")}
                  </span>
                </span>
              </p>
              {v.minReferenceHourlyPrice !== null && (
                <p className="mt-1 text-sm font-semibold text-primary">
                  {t("fromPerHour", { price: formatVND(v.minReferenceHourlyPrice, locale) })}
                </p>
              )}
              <Link href={v.detailUrl} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                {t("viewVenue")} <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </article>
          ))}
        </div>
      )}

      {answer.comparison && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <tbody>
              {answer.comparison.rows.map((row) => (
                <tr key={row.key} className="border-b last:border-0">
                  <th className="bg-slate-50 px-3 py-2 align-top font-medium text-slate-500">{row.label}</th>
                  {row.values.map((value, j) => (
                    <td key={j} className="px-3 py-2 align-top">{value === null || value === undefined ? "—" : String(value)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {answer.evidence.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">{t("evidenceTitle")}</p>
          <div className="flex flex-col gap-2">
            {answer.evidence.map((ev) => (
              <details key={ev.evidenceId} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <summary className="cursor-pointer text-sm leading-relaxed text-slate-700">
                  “{ev.quote}”
                  <span className="ml-2 whitespace-nowrap text-xs text-slate-400">
                    {ev.venueName} · {ev.source === "google" ? t("googleSource") : t("inAppSource")} · ★ {ev.rating}
                    {ev.relativeTimeRaw ? ` · ${ev.relativeTimeRaw}` : ""}
                  </span>
                </summary>
                <p className="mt-2 whitespace-pre-line border-t pt-2 text-sm leading-relaxed text-slate-600">{ev.fullText}</p>
                <p className="mt-1 text-xs text-slate-400">— {ev.authorLabel}</p>
                <Link href={ev.citationTarget} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                  {t("viewAtVenue")} <ExternalLink className="h-3 w-3" />
                </Link>
              </details>
            ))}
          </div>
        </div>
      )}

      {answer.options.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">{t("optionsTitle")}</p>
          <ul className="flex flex-col gap-2">
            {answer.options.map((o) => (
              <li key={o.optionId} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                <span className="font-semibold">{o.facilityName}</span> · {o.date} · {o.startTime}–{o.endTime} ({o.durationHours}h)
                {o.totalPrice !== null ? (
                  <span className="ml-2 font-bold text-primary">{t("totalLabel")}: {formatVND(o.totalPrice, locale)}</span>
                ) : (
                  <span className="ml-2 text-slate-400">—</span>
                )}
                <span className="mt-0.5 block text-xs text-slate-400">
                  {t("referencePriceNote")} · {t("demoScheduleNote")}
                  {o.meetsBudget === true ? ` · ${t("withinBudget")}` : o.meetsBudget === false ? ` · ${t("overBudget")}` : ""}
                  {!o.slotAvailable ? " · ✕" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {answer.handoff && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 px-4 py-3">
          <p className="font-bold text-primary">{t("handoffTitle")}</p>
          <p className="mt-1 text-sm leading-relaxed">
            {answer.handoff.venueName} — {answer.handoff.facilityName}
            <br />
            {answer.handoff.date} · {answer.handoff.startTime}–{answer.handoff.endTime} ({answer.handoff.durationHours}h)
            <br />
            <strong>{t("totalLabel")}: {formatVND(answer.handoff.totalPrice, locale)}</strong>
          </p>
          <ul className="mt-1.5 list-inside list-disc text-xs text-slate-500">
            {answer.handoff.labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
            <li>{t("quoteNotHeld")}</li>
            <li>
              {t("refundPolicy", {
                full: answer.handoff.policySummary.fullRefundBeforeHours,
                partial: answer.handoff.policySummary.partialRefundBeforeHours,
                fee: answer.handoff.policySummary.partialFeePercent,
              })}
            </li>
          </ul>
          <Link href={answer.handoff.bookingUrl} className="btn-primary mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-sm">
            {t("handoffButton")} <ExternalLink className="h-4 w-4" />
          </Link>
          <p className="mt-2 text-xs text-slate-500">{t("loginToConfirm")}</p>
        </div>
      )}

      {answer.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700">{t("warningsTitle")}</p>
          <ul className="mt-1 list-inside list-disc text-xs leading-relaxed text-amber-800">
            {answer.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
