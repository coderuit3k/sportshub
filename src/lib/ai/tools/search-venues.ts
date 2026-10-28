/**
 * search_venues — structured candidate search over PUBLIC venues only.
 *
 * Semantics worth noting (audit-driven):
 * - Name/district matching is diacritic-insensitive (folded), so
 *   "cau long" finds "Cầu Lông"; multiple venues sharing a name are all
 *   returned with district+address for disambiguation.
 * - District matching falls back to the ADDRESS when the district
 *   column does not match: most imported venues carry an empty or
 *   ward-level district (post-2025 addresses name the ward, not the
 *   district), so a district query also matches the district text —
 *   or a curated ward alias for the area — inside the address. Any
 *   result that only matched via this fallback is disclosed with a
 *   warning; it is a text match, not verified geography.
 * - Rating filters and ordering use the EFFECTIVE rating (Google
 *   aggregate first, in-app fallback) — the same helper as the site.
 * - maxReferenceHourlyPrice compares the venue's minimum reference
 *   hourly price; it is an orientation filter, never a slot quote.
 * - Amenities: for venues whose amenity list is platform-generated
 *   (imported/sample catalogs), an amenity is NEVER reported as a
 *   satisfied hard constraint — the venue is returned with the amenity
 *   in `uncheckedConditions` instead of being silently dropped or
 *   silently passed.
 * - The tool takes NO user coordinates: "near me" must be resolved by
 *   the caller into a district (see the assistant's clarification
 *   policy); browser geolocation never reaches the server/model.
 */
import { SearchVenuesInput, type SearchVenuesArgs } from "../schemas";
import { errorEnvelope, okEnvelope, ToolErrorCode, type ToolContext, type ToolEnvelope } from "../types";
import { foldedIncludes, foldTokens, foldVi } from "../text";
import { resolveSportSlug, shapeVenueCard, VENUE_INCLUDE, type VenueCardData, type VenueRow } from "./shared";
import { venueProvenance } from "../types";

export interface SearchVenuesData {
  venues: (VenueCardData & { uncheckedConditions: string[] })[];
  totalMatched: number;
}

/**
 * Ward tokens that belong to a colloquial district/area name, keyed by
 * the FOLDED district query. Imported catalog addresses (post-2025
 * two-tier administration) name wards, so "Thủ Đức" rarely appears
 * literally even for venues inside the former Thủ Đức city. Tokens
 * are only added when verified against real catalog addresses —
 * extend deliberately, never guess geography.
 * Verified 2026-10-27: Linh Xuân / Bình Trưng / An Khánh are wards of
 * the former Thủ Đức city (ex-Quận 2 / Thủ Đức) appearing in catalog
 * addresses of venues the district column leaves blank.
 */
const DISTRICT_ADDRESS_ALIASES: Record<string, string[]> = {
  "thu duc": ["linh xuan", "an khanh", "binh trung"],
  // Verified 2026-10-28 against catalog addresses: Tân Hưng (Sân
  // Tennis & Pickleball VIỆT PHỐ Q.7; Hồ bơi Sky Garden, Phú Mỹ Hưng),
  // Phú Thuận (Sân Tennis Tấn Trường, đường Đào Trí) and the Phú Mỹ
  // Hưng urban area (Sky Garden; Sân bóng đá mini Phú Mỹ Hưng) are
  // District 7 wards/areas named in addresses whose district column
  // is blank. Live-eval case 6 (English "District 7") found nothing
  // before this entry existed.
  "quan 7": ["tan hung", "phu thuan", "phu my hung"],
};

/**
 * Folded forms of a district query to try: the query as given, plus a
 * variant with an administrative prefix stripped ("Quận Thủ Đức" /
 * "Thành phố Thủ Đức" / "TP. Thủ Đức" → "thu duc"). The stripped form
 * is only used when it stays ≥3 chars, so numeric districts ("Quận 7"
 * → "7") never degrade into a substring match on a single digit.
 */
function districtNeedles(district: string): string[] {
  const folded = foldVi(district).trim().replace(/\s+/g, " ");
  const needles = new Set<string>([folded]);
  const stripped = folded.replace(/^(thanh pho|quan|tp)\.?\s+/, "");
  if (stripped !== folded && stripped.length >= 3) needles.add(stripped);
  // English form: "District 7" → the Vietnamese needle "quan 7", which
  // is what catalog addresses/district values actually contain, and
  // the key the ward-alias map is indexed by.
  const enDistrict = folded.match(/^district\s+(.+)$/);
  if (enDistrict) needles.add(`quan ${enDistrict[1]}`);
  return [...needles];
}

function districtColumnMatches(v: VenueRow, district: string): boolean {
  if (districtNeedles(district).some((n) => foldedIncludes(v.district, n))) return true;
  // Token form, district field only: "Thu Duc City" vs column "Thủ Đức".
  const qTokens = districtTokens(district);
  if (qTokens.length > 0 && qTokens.some((t) => !/^\d+$/.test(t))) {
    const colTokens = new Set(foldTokens(v.district));
    return qTokens.every((t) => colTokens.has(t));
  }
  return false;
}

export function districtMatches(v: VenueRow, district: string): boolean {
  if (districtColumnMatches(v, district)) return true;
  for (const n of districtNeedles(district)) {
    if (foldedIncludes(v.address, n)) return true;
    const aliases = DISTRICT_ADDRESS_ALIASES[n] ?? [];
    if (aliases.some((alias) => foldedIncludes(v.address, alias))) return true;
  }
  // Token form over district+address: word order/suffixes a model may
  // add ("Thu Duc City", "city of Thu Duc") cannot break the match.
  // Skipped for purely numeric districts ("Quận 7" → token "7"), where
  // a stray digit token in an unrelated address would false-match.
  const qTokens = districtTokens(district);
  if (qTokens.length > 0 && qTokens.some((t) => !/^\d+$/.test(t))) {
    const venueTokens = new Set([...foldTokens(v.district), ...foldTokens(v.address)]);
    if (qTokens.every((t) => venueTokens.has(t))) return true;
    const aliases = DISTRICT_ADDRESS_ALIASES[qTokens.join(" ")] ?? [];
    if (aliases.some((alias) => foldedIncludes(v.address, alias))) return true;
  }
  return false;
}

/** Administrative filler tokens dropped before token-form matching. */
const DISTRICT_GENERIC_TOKENS = new Set([
  "quan", "thanh", "pho", "tp", "city", "district", "thi", "xa", "huyen",
]);

function districtTokens(district: string): string[] {
  return foldTokens(district).filter((t) => !DISTRICT_GENERIC_TOKENS.has(t));
}

/**
 * Free-text query matching. Primary: the whole folded query as a
 * substring of name/district/address. Fallback (models often pack
 * sport + district into the query, e.g. "cầu lông thủ đức", which no
 * single field contains): every query TOKEN must appear as a token
 * in the combined name+district+address — tokens already enforced by
 * the district filter are dropped first. Token equality (not
 * substring) keeps short tokens from firing inside longer words.
 */
function queryMatches(v: VenueRow, query: string, districtTokens: Set<string>): boolean {
  if (
    foldedIncludes(v.name, query) ||
    foldedIncludes(v.district, query) ||
    foldedIncludes(v.address, query)
  ) {
    return true;
  }
  const qTokens = foldTokens(query).filter((t) => !districtTokens.has(t));
  if (qTokens.length === 0) return true;
  const text = new Set([
    ...foldTokens(v.name),
    ...foldTokens(v.district),
    ...foldTokens(v.address),
  ]);
  return qTokens.every((t) => text.has(t));
}

export async function searchVenues(
  ctx: ToolContext,
  rawInput: unknown,
): Promise<ToolEnvelope<SearchVenuesData>> {
  const parsed = SearchVenuesInput.safeParse(rawInput);
  if (!parsed.success) {
    return errorEnvelope(ToolErrorCode.InvalidInput, parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const args: SearchVenuesArgs = parsed.data;
  if (!ctx.budget.consume()) {
    return errorEnvelope(ToolErrorCode.BudgetExhausted, "Tool budget exhausted");
  }
  try {
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
    const rows = (await ctx.db.venue.findMany({
      where: {
        status: "APPROVED",
        ...(args.sportSlug ? { sports: { some: { sport: { slug: args.sportSlug } } } } : {}),
      },
      include: VENUE_INCLUDE,
    })) as unknown as VenueRow[];

    const warnings: string[] = [];
    let matched = rows;

    if (args.district) {
      matched = matched.filter((v) => districtMatches(v, args.district!));
      if (matched.some((v) => !districtColumnMatches(v, args.district!))) {
        warnings.push(
          "Một số sân được khớp theo địa chỉ (tên phường/khu vực trong địa chỉ) vì dữ liệu quận của sân nhập từ nguồn ngoài không đầy đủ — đây là khớp theo văn bản địa chỉ, chưa phải vị trí đã xác minh.",
        );
      }
    }
    if (args.query) {
      const districtTokens = new Set(
        args.district ? districtNeedles(args.district).flatMap((n) => foldTokens(n)) : [],
      );
      matched = matched.filter((v) => queryMatches(v, args.query!, districtTokens));
    }
    if (args.minRating != null) {
      matched = matched.filter((v) => (v.googleRating ?? v.ratingAvg) >= args.minRating!);
    }

    const shaped = matched.map((row) => {
      const card = shapeVenueCard(row);
      const uncheckedConditions: string[] = [];
      if (args.amenities && args.amenities.length > 0) {
        const prov = venueProvenance(row.source);
        const have = new Set(row.amenities.map((a) => a.name.toLowerCase()));
        for (const want of args.amenities) {
          const present = [...have].some((h) => h.includes(want.toLowerCase()));
          if (prov.amenities !== "owner_verified") {
            // Amenity list is generated/unverified for this venue: the
            // condition is reported as UNCHECKED, never as satisfied.
            uncheckedConditions.push(`amenity_unverified:${want}`);
          } else if (!present) {
            uncheckedConditions.push(`amenity_missing:${want}`);
          }
        }
      }
      return { row, card: { ...card, uncheckedConditions } };
    });

    // A venue whose OWNER-VERIFIED amenity is missing fails a hard
    // constraint and drops out; unverified-amenity venues stay, flagged.
    const kept = shaped.filter(
      (s) => !s.card.uncheckedConditions.some((c) => c.startsWith("amenity_missing:")),
    );

    let filtered = kept;
    if (args.maxReferenceHourlyPrice != null) {
      filtered = kept.filter(
        (s) =>
          s.card.minReferenceHourlyPrice !== null &&
          s.card.minReferenceHourlyPrice <= args.maxReferenceHourlyPrice!,
      );
    }

    filtered.sort((a, b) => {
      const byRating = b.card.rating.value - a.card.rating.value;
      if (byRating !== 0) return byRating;
      return (a.card.minReferenceHourlyPrice ?? Infinity) - (b.card.minReferenceHourlyPrice ?? Infinity);
    });

    if ((args.amenities?.length ?? 0) > 0) {
      warnings.push(
        "Tiện ích của các sân nhập từ nguồn ngoài là dữ liệu mặc định của nền tảng, chưa được chủ sân xác minh — các điều kiện tiện ích được đánh dấu chưa kiểm chứng thay vì khẳng định.",
      );
    }

    const venues = filtered.slice(0, args.limit).map((s) => s.card);
    return okEnvelope(
      { venues, totalMatched: filtered.length },
      {
        status: venues.length === 0 ? "empty" : "ok",
        appliedFilters: { ...args },
        checkedAt: ctx.now.toISOString(),
        warnings,
        provenance: { prices: "platform_reference", ratings: "imported" },
      },
    );
  } catch (e) {
    return errorEnvelope(ToolErrorCode.DbError, e instanceof Error ? e.message : "Database error");
  }
}
