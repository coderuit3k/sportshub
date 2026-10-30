/**
 * compare_venue_options — a composite SERVICE (not another agent): it
 * fans out to the profile, stats and bookable-options tools under the
 * SAME budget counter, then lines the results up under IDENTICAL
 * conditions.
 *
 * Rules:
 * - Prices are only compared when date/time/duration are the same for
 *   every option (a single bookable-options call shape per venue).
 * - A venue's minimum reference price is never compared against
 *   another venue's peak-hour quote.
 * - Missing data is shown as "unknown", never as a demerit: no review
 *   evidence about an aspect means "no data", not "bad".
 * - No invented composite quality score. The only score-like figure is
 *   DATA COMPLETENESS (how much of the comparison could be filled in),
 *   labelled as such.
 */
import { CompareVenuesInput } from "../schemas";
import { errorEnvelope, okEnvelope, ToolErrorCode, type ToolContext, type ToolEnvelope } from "../types";
import { getVenueProfile } from "./get-venue-profile";
import { getReviewSummaryStats } from "./review-stats";
import { getBookableOptions, type BookableOption } from "./bookable-options";

export interface ComparisonRow {
  key: string;
  label: string;
  values: (string | number | null)[];
}

/**
 * Per-venue quote outcome. The distinction that matters: an ERROR
 * (timeout, budget, DB, invalid input) is `unknown_due_to_error` —
 * it is NOT evidence that the venue has no slot. Only a completed
 * quote query can produce `unavailable`. A slot that exists but
 * cannot be priced is `price_unavailable`, never "free".
 */
export type QuoteOutcome =
  | "available"
  | "unavailable"
  | "price_unavailable"
  | "unknown_due_to_error"
  | "not_checked";

export interface VenueOutcome {
  venueId: string;
  profile: "ok" | "error";
  profileErrorCode: string | null;
  quote: QuoteOutcome;
  quoteErrorCode: string | null;
  quoteCheckedAt: string | null;
}

export interface VenueComparison {
  venueIds: string[];
  rows: ComparisonRow[];
  perVenue: {
    venueId: string;
    matchedConstraints: string[];
    unmetConstraints: string[];
    unknownFields: string[];
    dataCompleteness: number; // 0..1 — completeness of DATA, not quality
    bestOption: BookableOption | null;
    quoteOutcome: QuoteOutcome;
  }[];
  venueOutcomes: VenueOutcome[];
  conditions: { date: string | null; startTime: string | null; durationHours: number | null };
}

export async function compareVenueOptions(
  ctx: ToolContext,
  rawInput: unknown,
): Promise<ToolEnvelope<VenueComparison>> {
  const parsed = CompareVenuesInput.safeParse(rawInput);
  if (!parsed.success) {
    return errorEnvelope(ToolErrorCode.InvalidInput, parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (!ctx.budget.consume()) {
    return errorEnvelope(ToolErrorCode.BudgetExhausted, "Tool budget exhausted");
  }
  const args = parsed.data;
  const warnings: string[] = [];
  const evidenceRefs: string[] = [];

  try {
    // Per-venue sub-calls run in PARALLEL (order preserved): against a
    // remote production database the sequential fan-out alone could
    // exceed the per-tool timeout. Budget consumption is synchronous,
    // so sharing one counter across parallel calls stays exact.
    const profileResults = await Promise.all(
      args.venueIds.map((venueId) => getVenueProfile(ctx, { venueId })),
    );
    // A failed profile no longer sinks the whole comparison: the
    // venue stays in the result as an explicit unknown (null row
    // values, profile: "error" in venueOutcomes) and the envelope
    // degrades to "partial". Only when EVERY profile fails is there
    // nothing usable to compare → error envelope.
    const profiles: (Awaited<ReturnType<typeof getVenueProfile>>["data"])[] = [];
    const profileErrors = new Map<string, string>();
    profileResults.forEach((p, i) => {
      if (p.status === "error" || !p.data) {
        profiles.push(null);
        profileErrors.set(args.venueIds[i], p.error?.code ?? ToolErrorCode.NotFound);
      } else {
        profiles.push(p.data);
        warnings.push(...p.warnings);
      }
    });
    if (profiles.every((p) => p === null)) {
      const first = profileResults[0];
      return errorEnvelope(first?.error?.code ?? ToolErrorCode.NotFound, first?.error?.message ?? "Profiles unavailable", {
        warnings,
      });
    }

    const stats = await getReviewSummaryStats(ctx, {
      venueIds: args.venueIds,
      source: "all",
      aspects: args.aspects,
    });
    if (stats.data) warnings.push(...stats.warnings);
    else if (stats.error) {
      // Stats failure must be visible, never silently read as zeros.
      warnings.push(`Không lấy được thống kê đánh giá (${stats.error.code}) — các ô thống kê để trống, không phải 0.`);
    }

    // Same-condition quotes: one identical request shape per venue,
    // fetched in parallel like the profiles above. Every venue gets an
    // explicit QuoteOutcome — an errored sub-call is recorded as
    // unknown_due_to_error with its errorCode, NEVER collapsed into
    // "no available option".
    const bestOptions = new Map<string, BookableOption | null>();
    const quoteOutcomes = new Map<string, { outcome: QuoteOutcome; errorCode: string | null; checkedAt: string | null }>();
    for (const venueId of args.venueIds) {
      quoteOutcomes.set(venueId, { outcome: "not_checked", errorCode: null, checkedAt: null });
    }
    if (args.date && args.durationHours) {
      const quoteResults = await Promise.all(
        args.venueIds.map((venueId) =>
          getBookableOptions(ctx, {
            venueId,
            date: args.date,
            preferredStartTime: args.startTime,
            durationHours: args.durationHours,
            budgetAmount: args.budgetAmount,
            budgetBasis: args.budgetBasis,
          }),
        ),
      );
      quoteResults.forEach((q, i) => {
        const venueId = args.venueIds[i];
        if (q.status === "error" || !q.data) {
          bestOptions.set(venueId, null);
          quoteOutcomes.set(venueId, {
            outcome: "unknown_due_to_error",
            errorCode: q.error?.code ?? ToolErrorCode.DbError,
            checkedAt: q.checkedAt ?? null,
          });
          return;
        }
        warnings.push(...q.warnings);
        const availablePriced = q.data.options.filter((o) => o.slotAvailable && o.priceStatus === "ok");
        availablePriced.sort((a, b) => (a.totalPrice ?? Infinity) - (b.totalPrice ?? Infinity));
        if (availablePriced.length > 0) {
          bestOptions.set(venueId, availablePriced[0]);
          quoteOutcomes.set(venueId, { outcome: "available", errorCode: null, checkedAt: q.data.checkedAt });
        } else if (q.data.options.some((o) => o.priceStatus === "unavailable")) {
          // A quote with unknown price is not evidence that the venue has no slots.
          bestOptions.set(venueId, null);
          quoteOutcomes.set(venueId, { outcome: "price_unavailable", errorCode: ToolErrorCode.PriceUnavailable, checkedAt: q.data.checkedAt });
        } else {
          bestOptions.set(venueId, null);
          quoteOutcomes.set(venueId, { outcome: "unavailable", errorCode: null, checkedAt: q.data.checkedAt });
        }
      });
    }

    const rows: ComparisonRow[] = [
      { key: "name", label: "Sân", values: profiles.map((p) => (p ? `${p.name} (${p.district})` : null)) },
      { key: "googleRating", label: "Điểm Google", values: profiles.map((p) => p?.googleRating?.value ?? null) },
      { key: "googleRatingCount", label: "Số đánh giá Google", values: profiles.map((p) => p?.googleRating?.count ?? null) },
      { key: "inAppRating", label: "Điểm trong SportsHub", values: profiles.map((p) => (p && p.inAppRating.count > 0 ? p.inAppRating.value : null)) },
      {
        key: "minReferenceHourlyPrice",
        label: "Giá tham chiếu thấp nhất (mỗi giờ)",
        values: profiles.map((p) => {
          if (!p) return null;
          const prices = p.facilities.map((f) => f.minReferenceHourlyPrice).filter((x): x is number => x !== null);
          return prices.length ? Math.min(...prices) : null;
        }),
      },
    ];
    if (args.date && args.durationHours) {
      rows.push({
        key: "quoteSameConditions",
        label: `Tổng giá ${args.durationHours} giờ ngày ${args.date}${args.startTime ? ` từ ${args.startTime}` : ""}`,
        values: args.venueIds.map((venueId) => bestOptions.get(venueId)?.totalPrice ?? null),
      });
    }
    if (stats.data && args.aspects) {
      for (const aspect of args.aspects) {
        rows.push({
          key: `aspect:${aspect}`,
          label: `Review nhắc tới: ${aspect}`,
          values: stats.data.venues.map((v) => {
            const a = v.googleSample?.aspects.find((x) => x.aspect === aspect);
            if (!a) return null;
            return `${a.positive}+/${a.negative}-/${a.mixed}~ trên ${a.mentioningReviews} review nhắc tới`;
          }),
        });
      }
    }

    const perVenue = args.venueIds.map((venueId, i) => {
      const p = profiles[i];
      const quote = quoteOutcomes.get(venueId)!;
      if (!p) {
        return {
          venueId,
          matchedConstraints: [] as string[],
          unmetConstraints: [] as string[],
          unknownFields: ["profile", "googleRating", "inAppRating", "prices", "operatingHours"],
          dataCompleteness: 0,
          bestOption: null,
          quoteOutcome: quote.outcome,
        };
      }
      const unknownFields: string[] = [];
      if (!p.googleRating) unknownFields.push("googleRating");
      if (p.inAppRating.count === 0) unknownFields.push("inAppRating");
      if (p.facilities.every((f) => f.minReferenceHourlyPrice === null)) unknownFields.push("prices");
      if (p.operatingHours.length === 0) unknownFields.push("operatingHours");
      if (quote.outcome === "unknown_due_to_error") unknownFields.push("availability");
      if (quote.outcome === "price_unavailable") unknownFields.push("quotePrice");
      const known = 4 - unknownFields.filter((f) => ["googleRating", "inAppRating", "prices", "operatingHours"].includes(f)).length;
      const matched: string[] = [];
      const unmet: string[] = [];
      const best = bestOptions.get(venueId) ?? null;
      // "no_available_option" is a CONCLUSION and may only be drawn
      // from a completed quote query that found no slot. An errored
      // or unpriced check leaves the constraint undecided (unknown),
      // so the venue is never ranked as worse because a tool failed.
      if (args.budgetAmount != null) {
        if (best && best.meetsBudget) matched.push("budget");
        else if (best) unmet.push("budget");
        else if (quote.outcome === "unavailable") unmet.push("no_available_option");
      }
      if (args.date && args.durationHours) {
        if (best) matched.push("availability_same_conditions");
        else if (quote.outcome === "unavailable" && !unmet.includes("no_available_option")) unmet.push("no_available_option");
      }
      return {
        venueId,
        matchedConstraints: matched,
        unmetConstraints: unmet,
        unknownFields,
        dataCompleteness: known / 4,
        bestOption: best,
        quoteOutcome: quote.outcome,
      };
    });

    const venueOutcomes: VenueOutcome[] = args.venueIds.map((venueId) => {
      const quote = quoteOutcomes.get(venueId)!;
      return {
        venueId,
        profile: profileErrors.has(venueId) ? "error" : "ok",
        profileErrorCode: profileErrors.get(venueId) ?? null,
        quote: quote.outcome,
        quoteErrorCode: quote.errorCode,
        quoteCheckedAt: quote.checkedAt,
      };
    });
    const hasUnknowns =
      profileErrors.size > 0 || venueOutcomes.some((o) => o.quote === "unknown_due_to_error");

    return okEnvelope(
      {
        venueIds: args.venueIds,
        rows,
        perVenue,
        venueOutcomes,
        conditions: { date: args.date ?? null, startTime: args.startTime ?? null, durationHours: args.durationHours ?? null },
      },
      {
        status: hasUnknowns ? "partial" : "ok",
        appliedFilters: { ...args },
        checkedAt: ctx.now.toISOString(),
        warnings: [...new Set(warnings)],
        provenance: { prices: "platform_reference", ratings: "imported" },
        evidenceRefs,
      },
    );
  } catch (e) {
    return errorEnvelope(ToolErrorCode.DbError, e instanceof Error ? e.message : "Database error");
  }
}
