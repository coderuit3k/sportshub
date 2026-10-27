/**
 * get_review_summary_stats — counts with explicit scopes and
 * denominators. Three populations are NEVER blended:
 *   A. The Google AGGREGATE (rating + count from the listing) — a
 *      Google-side figure, not a sample we can slice.
 *   B. The STORED Google review TEXTS — a small sample (Maps shows a
 *      limited set); distributions and aspect counts are computed over
 *      THIS sample only, with the sample size as denominator.
 *   C. In-app SportsHub reviews — seed rows reported separately and
 *      excluded from the organic figures by policy.
 *
 * Rules enforced here:
 * - Aspect counts count REVIEWS (a review mentioning an aspect in any
 *   clause counts once per aspect/sentiment), never chunks.
 * - A review with both positive and negative clauses about one aspect
 *   counts as "mixed" for that aspect (disclosed in `mixedPolicy`).
 * - Time ranges are only applied where a reliable publication date
 *   exists. Stored Google texts carry only a relative label and the
 *   row's createdAt is the IMPORT time — so a time filter over them
 *   returns UNSUPPORTED_TIME_FILTER instead of a fabricated date cut.
 */
import { ReviewStatsInput } from "../schemas";
import {
  errorEnvelope,
  okEnvelope,
  ToolErrorCode,
  type ToolContext,
  type ToolEnvelope,
} from "../types";
import { tagReview, ASPECT_TAXONOMY_VERSION, type Aspect } from "../aspects";

export interface AspectCounts {
  aspect: Aspect;
  positive: number;
  negative: number;
  mixed: number;
  /** Denominator: reviews in the sample that mention the aspect. */
  mentioningReviews: number;
  sampleSize: number;
}

export interface VenueStats {
  venueId: string;
  venueName: string;
  googleAggregate: { rating: number; count: number } | null;
  googleSample: {
    reviewCount: number;
    ratingDistribution: Record<string, number>;
    averageRating: number | null;
    aspects: AspectCounts[];
  } | null;
  inApp: {
    reviewCount: number;
    seedReviewCount: number;
    averageRating: number | null;
    ratingDistribution: Record<string, number>;
  } | null;
}

export interface ReviewStatsData {
  venues: VenueStats[];
  sampleScope: string;
  mixedPolicy: string;
  taxonomyVersion: string;
}

function aspectCountsFor(texts: string[], aspects: Aspect[] | undefined): AspectCounts[] {
  const wanted = aspects ?? [];
  const perAspect = new Map<Aspect, { pos: Set<number>; neg: Set<number> }>();
  texts.forEach((text, idx) => {
    const { pairs } = tagReview(text);
    for (const p of pairs) {
      if (wanted.length > 0 && !wanted.includes(p.aspect)) continue;
      const entry = perAspect.get(p.aspect) ?? { pos: new Set<number>(), neg: new Set<number>() };
      if (p.sentiment === "positive" || p.sentiment === "mixed") entry.pos.add(idx);
      if (p.sentiment === "negative" || p.sentiment === "mixed") entry.neg.add(idx);
      perAspect.set(p.aspect, entry);
    }
  });
  return [...perAspect.entries()].map(([aspect, { pos, neg }]) => {
    const both = [...pos].filter((i) => neg.has(i)).length;
    return {
      aspect,
      positive: pos.size - both,
      negative: neg.size - both,
      mixed: both,
      mentioningReviews: new Set([...pos, ...neg]).size,
      sampleSize: texts.length,
    };
  });
}

function distribution(ratings: number[]): Record<string, number> {
  const d: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const r of ratings) d[String(Math.min(5, Math.max(1, Math.round(r))))] += 1;
  return d;
}

export async function getReviewSummaryStats(
  ctx: ToolContext,
  rawInput: unknown,
): Promise<ToolEnvelope<ReviewStatsData>> {
  const parsed = ReviewStatsInput.safeParse(rawInput);
  if (!parsed.success) {
    return errorEnvelope(ToolErrorCode.InvalidInput, parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (!ctx.budget.consume()) {
    return errorEnvelope(ToolErrorCode.BudgetExhausted, "Tool budget exhausted");
  }
  const args = parsed.data;

  // Stored Google texts have no reliable publication date (relative
  // label only; createdAt = import time). A time filter over them
  // cannot be honoured honestly.
  if (args.timeRange && args.source !== "in_app") {
    return errorEnvelope(
      ToolErrorCode.UnsupportedTimeFilter,
      "Không lọc theo thời gian cho đánh giá Google đang lưu: chỉ có nhãn thời gian tương đối, không có ngày đăng đáng tin cậy.",
      { appliedFilters: { ...args } },
    );
  }

  try {
    const venues = await ctx.db.venue.findMany({
      where: { id: { in: args.venueIds }, status: "APPROVED" },
      select: { id: true, name: true, googleRating: true, googleRatingCount: true },
    });
    if (venues.length === 0) {
      return errorEnvelope(ToolErrorCode.NotPublic, "No public venue among the given ids");
    }
    const out: VenueStats[] = [];
    const warnings: string[] = [];
    for (const v of venues) {
      const stats: VenueStats = {
        venueId: v.id,
        venueName: v.name,
        googleAggregate:
          v.googleRating != null ? { rating: v.googleRating, count: v.googleRatingCount ?? 0 } : null,
        googleSample: null,
        inApp: null,
      };
      if (args.source !== "in_app") {
        const rows = await ctx.db.googleReview.findMany({ where: { venueId: v.id }, select: { rating: true, text: true } });
        stats.googleSample = {
          reviewCount: rows.length,
          ratingDistribution: distribution(rows.map((r) => r.rating)),
          averageRating: rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : null,
          aspects: aspectCountsFor(rows.map((r) => r.text), args.aspects),
        };
        if (rows.length > 0 && rows.length < 5) {
          warnings.push(`Sân ${v.name}: mẫu đánh giá Google đang lưu chỉ có ${rows.length} bài — không đủ đại diện cho toàn bộ khách hàng.`);
        }
      }
      if (args.source !== "google") {
        const rows = await ctx.db.review.findMany({ where: { venueId: v.id }, select: { rating: true, isSeed: true, createdAt: true } });
        const organic = args.timeRange
          ? rows.filter((r) => {
              const t = r.createdAt.getTime();
              return t >= new Date(`${args.timeRange!.from}T00:00:00+07:00`).getTime() &&
                     t <= new Date(`${args.timeRange!.to}T23:59:59+07:00`).getTime();
            })
          : rows;
        const real = organic.filter((r) => !r.isSeed);
        stats.inApp = {
          reviewCount: real.length,
          seedReviewCount: organic.filter((r) => r.isSeed).length,
          averageRating: real.length ? real.reduce((s, r) => s + r.rating, 0) / real.length : null,
          ratingDistribution: distribution(real.map((r) => r.rating)),
        };
      }
      out.push(stats);
    }
    return okEnvelope(
      {
        venues: out,
        sampleScope:
          "Google sample = các bài đánh giá Google đang lưu trong SportsHub (giới hạn bởi số bài Google hiển thị khi thu thập); Google aggregate là con số tổng hợp phía Google; in-app chỉ tính review thật, review seed báo riêng.",
        mixedPolicy:
          "Một review có cả mệnh đề tích cực và tiêu cực về cùng khía cạnh được đếm là mixed cho khía cạnh đó.",
        taxonomyVersion: ASPECT_TAXONOMY_VERSION,
      },
      {
        appliedFilters: { ...args },
        checkedAt: ctx.now.toISOString(),
        warnings,
        provenance: { googleAggregate: "imported", googleSample: "imported", inApp: "owner_verified" },
      },
    );
  } catch (e) {
    return errorEnvelope(ToolErrorCode.DbError, e instanceof Error ? e.message : "Database error");
  }
}
