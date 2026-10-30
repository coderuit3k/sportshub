/**
 * Zod input schemas for the seven assistant tools. Bounds live here so
 * neither the model nor a caller can widen a query past them (limits
 * are clamped by the schema itself, not by prompt instructions).
 */
import { z } from "zod";
import { ASPECTS } from "./aspects";

export const MAX_VENUE_RESULTS = 10;
export const MAX_EVIDENCE_RESULTS = 12;
export const MAX_COMPARE_VENUES = 3;

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 24h")
  .describe("Saigon wall-clock time HH:MM");

const dateISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .describe("Calendar date in Asia/Ho_Chi_Minh, YYYY-MM-DD");

/**
 * Money inputs are FULL VND amounts. The floor exists because a real
 * model was observed passing "200" for "200k" (200,000 VND): without
 * the floor that silently filtered out every venue and the model
 * reported "no venues under budget". An implausible amount is now an
 * INVALID_INPUT error the model can correct, never a silent empty.
 */
const vndAmount = (field: string) =>
  z
    .number()
    .int()
    .min(10_000, {
      message: `${field} must be a full VND amount (e.g. 200000 for "200k"), not a thousands figure`,
    })
    .max(100_000_000)
    .describe(`${field} must be a full VND amount (e.g. 200000 for "200k"), not a thousands figure`)
    .optional();

export const SearchVenuesInput = z.object({
  query: z.string().trim().max(120).optional(),
  sportSlug: z.string().trim().max(60).optional(),
  district: z.string().trim().max(80).optional(),
  minRating: z.number().min(0).max(5).optional(),
  maxReferenceHourlyPrice: vndAmount("maxReferenceHourlyPrice"),
  amenities: z.array(z.string().trim().max(60)).max(8).optional(),
  limit: z.number().int().min(1).max(MAX_VENUE_RESULTS).default(5),
});
export type SearchVenuesArgs = z.infer<typeof SearchVenuesInput>;

export const GetVenueProfileInput = z.object({
  venueId: z.string().min(1).max(80).optional(),
  slug: z.string().trim().max(120).optional(),
}).refine((v) => Boolean(v.venueId || v.slug), { message: "venueId or slug is required" })
  .describe("venueId or slug is required");
export type GetVenueProfileArgs = z.infer<typeof GetVenueProfileInput>;

export const SearchReviewEvidenceInput = z.object({
  venueIds: z.array(z.string().min(1).max(80)).min(1).max(MAX_COMPARE_VENUES),
  query: z.string().trim().max(200).optional(),
  aspects: z.array(z.enum(ASPECTS)).max(5).optional(),
  sentiment: z.enum(["positive", "negative", "mixed"]).optional(),
  source: z.enum(["google", "in_app", "all"]).default("all"),
  limit: z.number().int().min(1).max(MAX_EVIDENCE_RESULTS).default(6),
});
export type SearchReviewEvidenceArgs = z.infer<typeof SearchReviewEvidenceInput>;

export const ReviewStatsInput = z.object({
  venueIds: z.array(z.string().min(1).max(80)).min(1).max(MAX_COMPARE_VENUES),
  source: z.enum(["google", "in_app", "all"]).default("all"),
  aspects: z.array(z.enum(ASPECTS)).max(5).optional(),
  timeRange: z
    .object({ from: dateISO, to: dateISO })
    .optional()
    .describe("Only supportable for sources with reliable publication dates"),
});
export type ReviewStatsArgs = z.infer<typeof ReviewStatsInput>;

export const BookableOptionsInput = z.object({
  venueId: z.string().min(1).max(80),
  facilityIds: z.array(z.string().min(1).max(80)).max(6).optional(),
  sportSlug: z.string().trim().max(60).optional(),
  date: dateISO,
  preferredStartTime: hhmm.optional(),
  window: z.object({ from: hhmm, to: hhmm }).optional(),
  durationHours: z.number().int().min(1).max(6).default(1),
  budgetAmount: vndAmount("budgetAmount"),
  budgetBasis: z.enum(["per_hour", "total_session"]).optional(),
});
export type BookableOptionsArgs = z.infer<typeof BookableOptionsInput>;

export const CompareVenuesInput = z.object({
  venueIds: z.array(z.string().min(1).max(80)).min(2).max(MAX_COMPARE_VENUES),
  criteria: z.array(z.string().trim().max(80)).max(8).default([]),
  aspects: z.array(z.enum(ASPECTS)).max(3).optional(),
  date: dateISO.optional(),
  startTime: hhmm.optional(),
  durationHours: z.number().int().min(1).max(6).optional(),
  budgetAmount: vndAmount("budgetAmount"),
  budgetBasis: z.enum(["per_hour", "total_session"]).optional(),
});
export type CompareVenuesArgs = z.infer<typeof CompareVenuesInput>;

export const PrepareHandoffInput = z.object({
  venueId: z.string().min(1).max(80),
  facilityId: z.string().min(1).max(80),
  date: dateISO,
  startTime: hhmm,
  durationHours: z.number().int().min(1).max(6),
});
export type PrepareHandoffArgs = z.infer<typeof PrepareHandoffInput>;
