/**
 * get_venue_profile — one public venue, field-level provenance.
 *
 * Only APPROVED venues are visible to the public assistant. The DTO is
 * minimal and contains NO owner email, phone, internal notes or user
 * data. Missing data stays null/unknown — never filled in. The venue's
 * `verified` flag is reported as a verification STATUS string that
 * cannot be misread: imported listings are "not owner claimed".
 */
import { GetVenueProfileInput } from "../schemas";
import {
  errorEnvelope,
  okEnvelope,
  ToolErrorCode,
  venueProvenance,
  verificationStatus,
  type ProvenanceKind,
  type ToolContext,
  type ToolEnvelope,
} from "../types";
import { facilityMinPrice } from "@/lib/booking/logic";
import { VENUE_INCLUDE, type VenueRow } from "./shared";

export interface VenueProfileData {
  venueId: string;
  slug: string;
  name: string;
  description: string;
  address: string;
  district: string;
  city: string;
  venueType: string;
  detailUrl: string;
  sports: { slug: string; name: string }[];
  facilities: {
    facilityId: string;
    name: string;
    sportSlug: string;
    surface: string | null;
    capacity: number;
    minReferenceHourlyPrice: number | null;
    priceType: ProvenanceKind;
  }[];
  amenities: { name: string; provenance: ProvenanceKind }[];
  operatingHours: { dayOfWeek: number; openTime: string; closeTime: string }[];
  cancellationPolicy: {
    fullRefundBeforeHours: number;
    partialRefundBeforeHours: number;
    partialFeePercent: number;
    provenance: ProvenanceKind;
  };
  googleRating: { value: number; count: number } | null;
  inAppRating: { value: number; count: number };
  instantBooking: boolean;
  verificationStatus: string;
  provenance: Record<string, ProvenanceKind>;
}

export async function getVenueProfile(
  ctx: ToolContext,
  rawInput: unknown,
): Promise<ToolEnvelope<VenueProfileData>> {
  const parsed = GetVenueProfileInput.safeParse(rawInput);
  if (!parsed.success) {
    return errorEnvelope(ToolErrorCode.InvalidInput, parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (!ctx.budget.consume()) {
    return errorEnvelope(ToolErrorCode.BudgetExhausted, "Tool budget exhausted");
  }
  const { venueId, slug } = parsed.data;
  try {
    const row = (await ctx.db.venue.findFirst({
      where: venueId ? { id: venueId } : { slug: slug! },
      include: { ...VENUE_INCLUDE, hours: { orderBy: { dayOfWeek: "asc" } } },
    })) as (VenueRow & { hours: { dayOfWeek: number; openTime: string; closeTime: string }[] }) | null;
    if (!row) return errorEnvelope(ToolErrorCode.NotFound, "Venue not found");
    if (row.status !== "APPROVED") {
      return errorEnvelope(ToolErrorCode.NotPublic, "Venue is not public");
    }
    const prov = venueProvenance(row.source);
    const warnings: string[] = [];
    if (row.source === "google") {
      warnings.push(
        "Sân được nhập từ Google Maps và chưa có chủ sân xác nhận trên SportsHub: cơ sở vật chất, tiện ích là mặc định của nền tảng; giờ mở cửa được chuẩn hoá từ thông tin Google và có thể khác thực tế.",
      );
    }
    const data: VenueProfileData = {
      venueId: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      address: row.address,
      district: row.district,
      city: row.city,
      venueType: row.venueType,
      detailUrl: `/venues/${row.slug}`,
      sports: row.sports.map((s) => ({ slug: s.sport.slug, name: s.sport.name })),
      facilities: row.facilities.map((f) => ({
        facilityId: f.id,
        name: f.name,
        sportSlug: f.sport.slug,
        surface: f.surface,
        capacity: f.capacity,
        minReferenceHourlyPrice: facilityMinPrice(f.priceRules),
        priceType: prov.prices,
      })),
      amenities: row.amenities.map((a) => ({ name: a.name, provenance: prov.amenities })),
      operatingHours: row.hours.map((h) => ({ dayOfWeek: h.dayOfWeek, openTime: h.openTime, closeTime: h.closeTime })),
      cancellationPolicy: {
        fullRefundBeforeHours: row.cancelFullBeforeHours,
        partialRefundBeforeHours: row.cancelPartialBeforeHours,
        partialFeePercent: row.cancelPartialFeePercent,
        provenance: prov.cancellationPolicy,
      },
      googleRating:
        row.googleRating != null ? { value: row.googleRating, count: row.googleRatingCount ?? 0 } : null,
      inAppRating: { value: row.ratingAvg, count: row.ratingCount },
      instantBooking: row.instantBooking,
      verificationStatus: verificationStatus(row.source),
      provenance: prov,
    };
    return okEnvelope(data, {
      appliedFilters: { venueId: venueId ?? null, slug: slug ?? null },
      checkedAt: ctx.now.toISOString(),
      warnings,
      provenance: prov,
    });
  } catch (e) {
    return errorEnvelope(ToolErrorCode.DbError, e instanceof Error ? e.message : "Database error");
  }
}
