/**
 * search_review_evidence — verbatim review evidence with stable IDs.
 *
 * Retrieval is LEXICAL (keyword/aspect clause matching over stored
 * texts) — it is never described as semantic search. Guarantees:
 * - Every quote is an exact substring of a stored review (the clause
 *   produced by the clause splitter, or the full text when shorter).
 * - Evidence IDs are the stored review IDs (Google reviews carry the
 *   deterministic catalog ID — see prisma/real-catalog.ts), so a
 *   citation survives re-deploys while the text is unchanged.
 * - Aspect/sentiment pairs come from the SAME clause (aspects.ts).
 * - Review text is DATA. It is returned quoted, never interpreted as
 *   instructions; the orchestrator's system prompt says the same.
 * - For comparison/overview questions the caller should see both sides:
 *   when both sentiments exist in the candidate pool, the result keeps
 *   at least one item of each side (diversity rule) within the limit.
 * - One item per review (chunk duplicates are impossible by design:
 *   retrieval unit = review, best clause chosen per review).
 */
import { SearchReviewEvidenceInput } from "../schemas";
import {
  errorEnvelope,
  okEnvelope,
  ToolErrorCode,
  type ToolContext,
  type ToolEnvelope,
} from "../types";
import { foldTokens, foldVi } from "../text";
import { tagReview, ASPECT_TAXONOMY_VERSION, type Aspect, type Sentiment } from "../aspects";

export interface EvidenceItem {
  evidenceId: string;
  venueId: string;
  venueName: string;
  source: "google" | "in_app";
  /** Verbatim clause from the review (exact substring of `fullText`). */
  quote: string;
  fullText: string;
  authorLabel: string;
  rating: number;
  aspects: Aspect[];
  sentiment: Exclude<Sentiment, "neutral"> | "neutral";
  /** Reliable publication date — null when only a relative label exists. */
  publishedDate: string | null;
  relativeTimeRaw: string | null;
  contentVersion: string;
  citationTarget: string;
}

export interface ReviewEvidenceData {
  items: EvidenceItem[];
  taxonomyVersion: string;
  retrievalMethod: "lexical_clause_match";
}

interface Candidate extends EvidenceItem {
  score: number;
}

function bestClauseFor(
  text: string,
  queryTokens: string[],
  aspects: Aspect[] | undefined,
  sentiment: string | undefined,
): { quote: string; aspects: Aspect[]; sentiment: EvidenceItem["sentiment"]; score: number } | null {
  const { clauses } = tagReview(text);
  let best: { quote: string; aspects: Aspect[]; sentiment: EvidenceItem["sentiment"]; score: number } | null = null;
  for (const c of clauses) {
    const folded = foldVi(c.clause);
    let score = 0;
    if (aspects && aspects.length > 0) {
      const hit = c.aspects.filter((a) => aspects.includes(a)).length;
      if (hit === 0) continue;
      score += hit * 4;
    }
    if (sentiment && sentiment !== "mixed") {
      if (c.sentiment !== sentiment) continue;
      score += 2;
    }
    if (sentiment === "mixed" && c.sentiment === "mixed") score += 2;
    for (const t of queryTokens) if (folded.includes(t)) score += 1;
    if (score === 0 && (aspects?.length || queryTokens.length > 2)) continue;
    if (!best || score > best.score) {
      best = { quote: c.clause, aspects: c.aspects, sentiment: c.sentiment, score };
    }
  }
  if (!best && clauses.length > 0 && !aspects?.length && queryTokens.length === 0) {
    const c = clauses[0];
    best = { quote: c.clause, aspects: c.aspects, sentiment: c.sentiment, score: 0 };
  }
  // A query/aspect was given and nothing matched it: the review is NOT
  // evidence for this question. Returning an arbitrary clause would
  // fabricate relevance — abstain instead.
  if (best && best.score === 0 && (queryTokens.length > 0 || (aspects?.length ?? 0) > 0)) {
    return null;
  }
  return best;
}

export async function searchReviewEvidence(
  ctx: ToolContext,
  rawInput: unknown,
): Promise<ToolEnvelope<ReviewEvidenceData>> {
  const parsed = SearchReviewEvidenceInput.safeParse(rawInput);
  if (!parsed.success) {
    return errorEnvelope(ToolErrorCode.InvalidInput, parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (!ctx.budget.consume()) {
    return errorEnvelope(ToolErrorCode.BudgetExhausted, "Tool budget exhausted");
  }
  const args = parsed.data;
  try {
    const venues = await ctx.db.venue.findMany({
      where: { id: { in: args.venueIds }, status: "APPROVED" },
      select: { id: true, slug: true, name: true },
    });
    if (venues.length === 0) {
      return errorEnvelope(ToolErrorCode.NotPublic, "No public venue among the given ids");
    }
    const venueById = new Map(venues.map((v) => [v.id, v]));
    const queryTokens = args.query ? foldTokens(args.query) : [];

    const candidates: Candidate[] = [];

    if (args.source !== "in_app") {
      const rows = await ctx.db.googleReview.findMany({
        where: { venueId: { in: venues.map((v) => v.id) } },
        orderBy: { createdAt: "asc" },
      });
      for (const r of rows) {
        const best = bestClauseFor(r.text, queryTokens, args.aspects, args.sentiment);
        if (!best) continue;
        const v = venueById.get(r.venueId)!;
        candidates.push({
          evidenceId: r.id,
          venueId: r.venueId,
          venueName: v.name,
          source: "google",
          quote: best.quote,
          fullText: r.text,
          authorLabel: r.authorName,
          rating: r.rating,
          aspects: best.aspects,
          sentiment: best.sentiment,
          publishedDate: null, // only a relative label exists — never invent a date
          relativeTimeRaw: r.relativeTime,
          contentVersion: ASPECT_TAXONOMY_VERSION,
          citationTarget: `/venues/${v.slug}#review-${r.id}`,
          score: best.score,
        });
      }
    }

    if (args.source !== "google") {
      const rows = await ctx.db.review.findMany({
        where: { venueId: { in: venues.map((v) => v.id) }, isSeed: false },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });
      for (const r of rows) {
        const best = bestClauseFor(r.comment, queryTokens, args.aspects, args.sentiment);
        if (!best) continue;
        const v = venueById.get(r.venueId)!;
        candidates.push({
          evidenceId: r.id,
          venueId: r.venueId,
          venueName: v.name,
          source: "in_app",
          quote: best.quote,
          fullText: r.comment,
          authorLabel: r.user.name,
          rating: r.rating,
          aspects: best.aspects,
          sentiment: best.sentiment,
          publishedDate: r.createdAt.toISOString(),
          relativeTimeRaw: null,
          contentVersion: ASPECT_TAXONOMY_VERSION,
          citationTarget: `/venues/${v.slug}#review-${r.id}`,
          score: best.score,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    let items = candidates.slice(0, args.limit).map(({ score: _score, ...item }) => item);

    // Diversity: with a multi-item limit and both stances present in the
    // pool, never return a one-sided pack.
    if (args.limit >= 2 && items.length >= 2) {
      const poolPos = candidates.find((c) => c.sentiment === "positive");
      const poolNeg = candidates.find((c) => c.sentiment === "negative");
      const hasPos = items.some((i) => i.sentiment === "positive");
      const hasNeg = items.some((i) => i.sentiment === "negative");
      if (poolPos && !hasPos) items[items.length - 1] = stripScore(poolPos);
      if (poolNeg && !hasNeg) items[items.length - 1] = stripScore(poolNeg);
    }

    const warnings: string[] = [];
    if (items.length > 0 && items.every((i) => i.source === "google")) {
      warnings.push(
        "Bằng chứng lấy từ các bài đánh giá Google đang lưu trong SportsHub (mẫu giới hạn, không phải toàn bộ đánh giá trên Google).",
      );
    }
    return okEnvelope(
      { items, taxonomyVersion: ASPECT_TAXONOMY_VERSION, retrievalMethod: "lexical_clause_match" },
      {
        status: items.length === 0 ? "empty" : "ok",
        appliedFilters: { ...args },
        checkedAt: ctx.now.toISOString(),
        warnings,
        provenance: { reviews: "imported" },
        evidenceRefs: items.map((i) => i.evidenceId),
      },
    );
  } catch (e) {
    return errorEnvelope(ToolErrorCode.DbError, e instanceof Error ? e.message : "Database error");
  }
}

function stripScore(c: Candidate): EvidenceItem {
  const { score: _score, ...item } = c;
  return item;
}
