/**
 * get_bookable_options — availability + exact quotes via the EXISTING
 * booking service (`getAvailability` in src/services/bookings.ts) and
 * the pure pricing logic (`calculatePrice`, `aggregateSlots`). Nothing
 * about slots or prices is re-implemented here.
 *
 * Guarantees:
 * - A multi-hour option is offered only when EVERY consecutive hourly
 *   slot is free (aggregateSlots), inside opening hours, not in the
 *   past, and not conflicting with an active booking or blocked time
 *   (all enforced by the shared service).
 * - Totals are the sum of per-hour rule prices (peak crossings priced
 *   per hour) — never minPrice × duration.
 * - A facility without price rules yields price=null +
 *   priceStatus="unavailable" — never 0-as-free, never budget-passing.
 * - Results are computed live on every call (availability is never
 *   served from the public-data cache) and stamped with checkedAt.
 * - The scope is labelled honestly: this is the SportsHub demo
 *   schedule with platform reference prices, not a live owner calendar.
 */
import { BookableOptionsInput } from "../schemas";
import {
  AVAILABILITY_SCOPE,
  AVAILABILITY_WARNING,
  errorEnvelope,
  okEnvelope,
  ToolErrorCode,
  type ToolContext,
  type ToolEnvelope,
} from "../types";
import { getAvailability } from "@/services/bookings";
import { resolveSportSlug } from "./shared";
import { aggregateSlots, calculatePrice, type HourlySlot } from "@/lib/booking/logic";
import { formatTimeHHMM } from "@/lib/time/tz";

export interface BookableOption {
  optionId: string;
  venueId: string;
  facilityId: string;
  facilityName: string;
  sportSlug: string;
  date: string;
  startTime: string;
  endTime: string;
  startAt: string;
  endAt: string;
  durationHours: number;
  slotAvailable: boolean;
  totalPrice: number | null;
  pricePerHourBreakdown: { hourStart: string; ruleType: string; pricePerHour: number }[] | null;
  priceStatus: "ok" | "unavailable";
  priceType: "platform_reference" | "owner_verified";
  meetsBudget: boolean | null;
}

export interface BookableOptionsData {
  options: BookableOption[];
  availabilityScope: string;
  checkedAt: string;
}

export async function getBookableOptions(
  ctx: ToolContext,
  rawInput: unknown,
): Promise<ToolEnvelope<BookableOptionsData>> {
  const parsed = BookableOptionsInput.safeParse(rawInput);
  if (!parsed.success) {
    return errorEnvelope(ToolErrorCode.InvalidInput, parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (!ctx.budget.consume()) {
    return errorEnvelope(ToolErrorCode.BudgetExhausted, "Tool budget exhausted");
  }
  const args = parsed.data;
  const checkedAt = ctx.now.toISOString();
  try {
    const venue = await ctx.db.venue.findUnique({
      where: { id: args.venueId },
      select: { id: true, status: true, source: true },
    });
    if (!venue) return errorEnvelope(ToolErrorCode.NotFound, "Venue not found");
    if (venue.status !== "APPROVED") {
      return errorEnvelope(ToolErrorCode.NotPublic, "Venue is not public");
    }

    if (args.sportSlug) {
      const resolution = await resolveSportSlug(ctx.db, args.sportSlug);
      if (!resolution.ok) {
        return errorEnvelope(
          ToolErrorCode.UnsupportedFilter,
          `Unknown sportSlug "${args.sportSlug}". Valid sportSlug values: ${resolution.validSlugs.join(", ")}.`,
        );
      }
      args.sportSlug = resolution.slug;
    }

    const facilities = await ctx.db.facility.findMany({
      where: {
        venueId: args.venueId,
        ...(args.facilityIds ? { id: { in: args.facilityIds } } : {}),
        ...(args.sportSlug ? { sport: { slug: args.sportSlug } } : {}),
      },
      include: { priceRules: true, sport: true },
    });
    if (facilities.length === 0) {
      return okEnvelope(
        { options: [], availabilityScope: AVAILABILITY_SCOPE, checkedAt },
        { status: "empty", appliedFilters: { ...args }, checkedAt, warnings: [AVAILABILITY_WARNING] },
      );
    }

    const priceType = venue.source === "owner" ? "owner_verified" : "platform_reference";
    const options: BookableOption[] = [];
    const warnings: string[] = [AVAILABILITY_WARNING];

    for (const facility of facilities) {
      const avail = await getAvailability(facility.id, args.date, ctx.db);
      if (!avail) continue;
      const hourly: HourlySlot[] = avail.slots.map((s) => ({
        startAt: s.startAt.toISOString(),
        endAt: s.endAt.toISOString(),
        startTime: formatTimeHHMM(s.startAt),
        price: s.price,
        available: s.available,
        past: s.past,
      }));
      const hasRules = facility.priceRules.length > 0;
      if (!hasRules) {
        warnings.push(`Sân con ${facility.name} chưa có bảng giá trong hệ thống — không báo giá được.`);
      }
      const starts = aggregateSlots(hourly, args.durationHours);
      for (const start of starts) {
        if (args.preferredStartTime && start.startTime !== args.preferredStartTime) continue;
        if (args.window && (start.startTime < args.window.from || start.startTime >= args.window.to)) continue;
        let totalPrice: number | null = null;
        let breakdown: BookableOption["pricePerHourBreakdown"] = null;
        if (hasRules) {
          try {
            const priced = calculatePrice(facility.priceRules, new Date(start.startAt), new Date(start.endAt));
            totalPrice = priced.total;
            breakdown = priced.breakdown;
          } catch {
            totalPrice = null;
            breakdown = null;
          }
        }
        let meetsBudget: boolean | null = null;
        if (args.budgetAmount != null && totalPrice !== null && breakdown !== null) {
          meetsBudget =
            args.budgetBasis === "per_hour"
              ? breakdown.every((b) => b.pricePerHour <= args.budgetAmount!)
              : totalPrice <= args.budgetAmount;
        }
        options.push({
          optionId: `opt_${facility.id.slice(0, 8)}_${args.date}_${start.startTime.replace(":", "")}_${args.durationHours}h`,
          venueId: args.venueId,
          facilityId: facility.id,
          facilityName: facility.name,
          sportSlug: facility.sport.slug,
          date: args.date,
          startTime: start.startTime,
          endTime: formatTimeHHMM(new Date(start.endAt)),
          startAt: start.startAt,
          endAt: start.endAt,
          durationHours: args.durationHours,
          slotAvailable: start.available,
          totalPrice,
          pricePerHourBreakdown: breakdown,
          priceStatus: totalPrice !== null ? "ok" : "unavailable",
          priceType,
          meetsBudget,
        });
      }
    }

    options.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return okEnvelope(
      { options, availabilityScope: AVAILABILITY_SCOPE, checkedAt },
      {
        status: options.length === 0 ? "empty" : "ok",
        appliedFilters: { ...args },
        checkedAt,
        warnings,
        provenance: { prices: priceType, availability: "platform_reference" },
      },
    );
  } catch (e) {
    return errorEnvelope(ToolErrorCode.DbError, e instanceof Error ? e.message : "Database error");
  }
}
