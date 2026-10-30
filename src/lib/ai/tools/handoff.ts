/**
 * prepare_booking_handoff — build the confirmation card and hand the
 * user over to the EXISTING booking UI. This tool performs NO database
 * writes: no Booking, no Payment, no mutation of any kind (a dedicated
 * test counts rows before/after).
 *
 * The selection is revalidated FRESH at handoff time (the quote the
 * model saw earlier may be stale): the exact option is recomputed via
 * get_bookable_options and must still be slot-available and priced,
 * otherwise the handoff fails with a structured error instead of
 * sending the user to a dead end. The booking URL is generated HERE
 * from database facts (venue slug) + validated inputs — the model
 * never invents URLs or passes prices as truth. Identity comes from
 * the server session in the booking UI, never from the model.
 */
import { createHash } from "node:crypto";
import { PrepareHandoffInput } from "../schemas";
import {
  AVAILABILITY_SCOPE,
  errorEnvelope,
  okEnvelope,
  ToolErrorCode,
  venueProvenance,
  type ProvenanceKind,
  type ToolContext,
  type ToolEnvelope,
} from "../types";
import { getBookableOptions } from "./bookable-options";

export interface BookingHandoff {
  handoffId: string;
  venueId: string;
  venueName: string;
  venueDistrict: string;
  facilityId: string;
  facilityName: string;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  /** Freshly rechecked at handoff time. */
  totalPrice: number;
  priceType: "platform_reference" | "owner_verified";
  priceStatus: "ok";
  checkedAt: string;
  availabilityScope: string;
  policySummary: {
    fullRefundBeforeHours: number;
    partialRefundBeforeHours: number;
    partialFeePercent: number;
    provenance: ProvenanceKind;
  };
  /** Server-generated route into the existing booking widget, with the
   * selection pre-filled. The user confirms there — not here. */
  bookingUrl: string;
  authenticationRequirement: "login_required_to_confirm";
  labels: string[];
}

export async function prepareBookingHandoff(
  ctx: ToolContext,
  rawInput: unknown,
): Promise<ToolEnvelope<BookingHandoff>> {
  const parsed = PrepareHandoffInput.safeParse(rawInput);
  if (!parsed.success) {
    return errorEnvelope(ToolErrorCode.InvalidInput, parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (!ctx.budget.consume()) {
    return errorEnvelope(ToolErrorCode.BudgetExhausted, "Tool budget exhausted");
  }
  const args = parsed.data;
  try {
    const venue = await ctx.db.venue.findUnique({
      where: { id: args.venueId },
      select: {
        id: true, slug: true, name: true, district: true, status: true, source: true,
        cancelFullBeforeHours: true, cancelPartialBeforeHours: true, cancelPartialFeePercent: true,
      },
    });
    if (!venue) return errorEnvelope(ToolErrorCode.NotFound, "Venue not found");
    if (venue.status !== "APPROVED") {
      return errorEnvelope(ToolErrorCode.NotPublic, "Venue is not public");
    }

    // Fresh revalidation of the exact requested option.
    const fresh = await getBookableOptions(ctx, {
      venueId: args.venueId,
      facilityIds: [args.facilityId],
      date: args.date,
      preferredStartTime: args.startTime,
      durationHours: args.durationHours,
    });
    if (fresh.status === "error" || !fresh.data) {
      return errorEnvelope(fresh.error?.code ?? ToolErrorCode.DbError, fresh.error?.message ?? "Revalidation failed");
    }
    const option = fresh.data.options.find((o) => o.startTime === args.startTime);
    if (!option) {
      return errorEnvelope(
        ToolErrorCode.SlotUnavailable,
        "Khung giờ yêu cầu không còn trong lịch (có thể ngoài giờ mở cửa hoặc đã qua).",
      );
    }
    if (option.priceStatus !== "ok" || option.totalPrice === null) {
      return errorEnvelope(
        ToolErrorCode.PriceUnavailable,
        "Sân con này chưa có bảng giá trong hệ thống nên chưa thể chuẩn bị đặt sân.",
      );
    }
    if (!option.slotAvailable) {
      return errorEnvelope(
        ToolErrorCode.SlotUnavailable,
        "Khung giờ này vừa hết trống trong lịch SportsHub — vui lòng chọn giờ khác.",
      );
    }

    const handoffId =
      "ho_" +
      createHash("sha256")
        .update(`${args.venueId}|${args.facilityId}|${args.date}|${args.startTime}|${args.durationHours}|${fresh.checkedAt}`)
        .digest("hex")
        .slice(0, 16);

    const params = new URLSearchParams({
      facility: args.facilityId,
      date: args.date,
      start: args.startTime,
      duration: String(args.durationHours),
    });

    return okEnvelope(
      {
        handoffId,
        venueId: venue.id,
        venueName: venue.name,
        venueDistrict: venue.district,
        facilityId: option.facilityId,
        facilityName: option.facilityName,
        date: args.date,
        startTime: option.startTime,
        endTime: option.endTime,
        durationHours: args.durationHours,
        totalPrice: option.totalPrice,
        priceType: option.priceType,
        priceStatus: "ok",
        checkedAt: fresh.checkedAt,
        availabilityScope: AVAILABILITY_SCOPE,
        policySummary: {
          fullRefundBeforeHours: venue.cancelFullBeforeHours,
          partialRefundBeforeHours: venue.cancelPartialBeforeHours,
          partialFeePercent: venue.cancelPartialFeePercent,
          provenance: venueProvenance(venue.source).cancellationPolicy,
        },
        bookingUrl: `/venues/${venue.slug}?${params.toString()}`,
        authenticationRequirement: "login_required_to_confirm",
        labels: [
          "Giá tham chiếu của nền tảng, chưa được chủ sân xác nhận",
          "Lịch mô phỏng trong SportsHub",
          "Báo giá không giữ chỗ — slot có thể thay đổi trước khi bạn xác nhận",
        ],
      },
      {
        appliedFilters: { ...args },
        checkedAt: fresh.checkedAt,
        warnings: fresh.warnings,
        provenance: { prices: option.priceType, availability: "platform_reference" },
      },
    );
  } catch (e) {
    return errorEnvelope(ToolErrorCode.DbError, e instanceof Error ? e.message : "Database error");
  }
}
