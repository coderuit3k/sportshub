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
  }[];
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
    const profiles = [];
    for (const venueId of args.venueIds) {
      const p = await getVenueProfile(ctx, { venueId });
      if (p.status === "error" || !p.data) {
        return errorEnvelope(p.error?.code ?? ToolErrorCode.NotFound, p.error?.message ?? "Profile unavailable", {
          warnings,
        });
      }
      profiles.push(p.data);
      warnings.push(...p.warnings);
    }

    const stats = await getReviewSummaryStats(ctx, {
      venueIds: args.venueIds,
      source: "all",
      aspects: args.aspects,
    });
    if (stats.data) warnings.push(...stats.warnings);

    // Same-condition quotes: one identical request shape per venue.
    const bestOptions = new Map<string, BookableOption | null>();
    if (args.date && args.durationHours) {
      for (const venueId of args.venueIds) {
        const q = await getBookableOptions(ctx, {
          venueId,
          date: args.date,
          preferredStartTime: args.startTime,
          durationHours: args.durationHours,
          budgetAmount: args.budgetAmount,
          budgetBasis: args.budgetBasis,
        });
        if (q.data) {
          warnings.push(...q.warnings);
          const available = q.data.options.filter((o) => o.slotAvailable && o.priceStatus === "ok");
          available.sort((a, b) => (a.totalPrice ?? Infinity) - (b.totalPrice ?? Infinity));
          bestOptions.set(venueId, available[0] ?? null);
        } else {
          bestOptions.set(venueId, null);
        }
      }
    }

    const rows: ComparisonRow[] = [
      { key: "name", label: "Sân", values: profiles.map((p) => `${p.name} (${p.district})`) },
      { key: "googleRating", label: "Điểm Google", values: profiles.map((p) => p.googleRating?.value ?? null) },
      { key: "googleRatingCount", label: "Số đánh giá Google", values: profiles.map((p) => p.googleRating?.count ?? null) },
      { key: "inAppRating", label: "Điểm trong SportsHub", values: profiles.map((p) => (p.inAppRating.count > 0 ? p.inAppRating.value : null)) },
      {
        key: "minReferenceHourlyPrice",
        label: "Giá tham chiếu thấp nhất (mỗi giờ)",
        values: profiles.map((p) => {
          const prices = p.facilities.map((f) => f.minReferenceHourlyPrice).filter((x): x is number => x !== null);
          return prices.length ? Math.min(...prices) : null;
        }),
      },
    ];
    if (args.date && args.durationHours) {
      rows.push({
        key: "quoteSameConditions",
        label: `Tổng giá ${args.durationHours} giờ ngày ${args.date}${args.startTime ? ` từ ${args.startTime}` : ""}`,
        values: profiles.map((p) => bestOptions.get(p.venueId)?.totalPrice ?? null),
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

    const perVenue = profiles.map((p) => {
      const unknownFields: string[] = [];
      if (!p.googleRating) unknownFields.push("googleRating");
      if (p.inAppRating.count === 0) unknownFields.push("inAppRating");
      if (p.facilities.every((f) => f.minReferenceHourlyPrice === null)) unknownFields.push("prices");
      if (p.operatingHours.length === 0) unknownFields.push("operatingHours");
      const known = 4 - unknownFields.length;
      const matched: string[] = [];
      const unmet: string[] = [];
      const best = bestOptions.get(p.venueId) ?? null;
      if (args.budgetAmount != null) {
        if (best && best.meetsBudget) matched.push("budget");
        else if (best) unmet.push("budget");
        else if (args.date) unmet.push("no_available_option");
      }
      if (args.date && args.durationHours) {
        if (best) matched.push("availability_same_conditions");
        else if (!unmet.includes("no_available_option")) unmet.push("no_available_option");
      }
      return {
        venueId: p.venueId,
        matchedConstraints: matched,
        unmetConstraints: unmet,
        unknownFields,
        dataCompleteness: known / 4,
        bestOption: best,
      };
    });

    return okEnvelope(
      {
        venueIds: args.venueIds,
        rows,
        perVenue,
        conditions: { date: args.date ?? null, startTime: args.startTime ?? null, durationHours: args.durationHours ?? null },
      },
      {
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
