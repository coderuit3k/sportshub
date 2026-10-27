/**
 * Clause-level lexical aspect + sentiment tagging for review evidence.
 *
 * Method (versioned, deliberately NOT machine learning and never
 * described as semantic understanding):
 * - A review is split into clauses on sentence punctuation, newlines and
 *   contrast conjunctions ("nhưng", "tuy nhiên", "but").
 * - Each clause is matched against per-aspect keyword lists (Vietnamese
 *   + English, diacritic-folded, word-boundary matching so short words
 *   like "tệ" don't fire inside unrelated words).
 * - Sentiment is scored per CLAUSE from positive/negative keyword lists.
 * - An (aspect, sentiment) pair is only ever emitted from the SAME
 *   clause, so "Sàn trơn nhưng nhân viên nhiệt tình" yields
 *   court_surface→negative and staff→positive — never staff→negative.
 *
 * Quotes returned by the evidence tool are exact substrings of the
 * stored review text (tests assert `text.includes(quote)`).
 */
import { foldVi } from "./text";

export const ASPECT_TAXONOMY_VERSION = "aspect-lex-v1";

export const ASPECTS = [
  "lighting",
  "court_surface",
  "staff",
  "cleanliness",
  "price_value",
  "parking",
  "air_conditioning",
  "crowding",
  "equipment",
  "location_access",
] as const;
export type Aspect = (typeof ASPECTS)[number];

const ASPECT_KEYWORDS: Record<Aspect, string[]> = {
  lighting: ["anh sang", "den", "choi", "sang", "glare", "light", "lighting", "bright", "dark"],
  court_surface: ["san", "mat san", "tron", "nut", "tham", "court", "surface", "floor", "slippery"],
  staff: ["nhan vien", "chu san", "phuc vu", "staff", "owner", "service", "tiep don"],
  cleanliness: ["ve sinh", "sach", "ban", "nha ve sinh", "toilet", "phong tam", "clean", "dirty", "hygiene"],
  price_value: ["gia", "dat", "gia re", "tien", "price", "expensive", "cheap", "worth", "cost"],
  parking: ["dau xe", "gui xe", "bai xe", "parking", "de xe"],
  air_conditioning: ["may lanh", "dieu hoa", "nong", "thoang", "aircon", "air conditioning", "hot", "cool"],
  crowding: ["dong", "chat", "ken", "crowd", "crowded", "packed"],
  equipment: ["vot", "bong", "luoi", "net", "racket", "ball", "equipment"],
  location_access: ["di lai", "duong di", "xa trung tam", "gan trung tam", "location", "access"],
};

const POSITIVE_WORDS = [
  "tot", "dep", "sach se", "nhiet tinh", "than thien", "rong", "thoang", "moi", "hai long",
  "tuyet", "ok", "chuan", "nhanh", "de chiu", "good", "great", "clean", "friendly",
  "nice", "excellent", "spacious", "comfortable",
];
const NEGATIVE_WORDS = [
  "te", "ban", "tron", "choi", "dat", "nong", "cu", "hong", "kem", "thai do", "cham",
  "hep", "bad", "dirty", "slippery", "expensive", "rude", "slow", "broken", "poor",
];

/** Word-boundary keyword match on already-folded text, so short
 * keywords ("te", "cu", "san") cannot fire inside longer words. */
export function foldedKeywordMatch(foldedText: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(foldedText);
}

export type Sentiment = "positive" | "negative" | "mixed" | "neutral";

export interface ClauseTag {
  /** Exact substring of the original review text (outer whitespace trimmed). */
  clause: string;
  aspects: Aspect[];
  sentiment: Sentiment;
}

export interface AspectSentiment {
  aspect: Aspect;
  sentiment: Exclude<Sentiment, "neutral">;
  clause: string;
}

/** Split review text into clauses, keeping each clause an exact
 * substring of the input. Contrast conjunctions start a new clause. */
export function splitClauses(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?;])\s+|\s+(?=nhưng\s)|\s+(?=tuy nhiên\s)|\s+(?=but\s)/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function clauseSentiment(foldedClause: string): Sentiment {
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE_WORDS) if (foldedKeywordMatch(foldedClause, w)) pos += 1;
  for (const w of NEGATIVE_WORDS) if (foldedKeywordMatch(foldedClause, w)) neg += 1;
  if (pos > 0 && neg > 0) return "mixed";
  if (pos > 0) return "positive";
  if (neg > 0) return "negative";
  return "neutral";
}

/** Tag one review text into clause-level (aspect, sentiment) pairs. */
export function tagReview(text: string): { clauses: ClauseTag[]; pairs: AspectSentiment[] } {
  const clauses: ClauseTag[] = [];
  const pairs: AspectSentiment[] = [];
  for (const clause of splitClauses(text)) {
    const folded = foldVi(clause);
    const aspects = ASPECTS.filter((a) => ASPECT_KEYWORDS[a].some((k) => foldedKeywordMatch(folded, k)));
    const sentiment = clauseSentiment(folded);
    clauses.push({ clause, aspects, sentiment });
    if (sentiment !== "neutral") {
      for (const aspect of aspects) pairs.push({ aspect, sentiment, clause });
    }
  }
  return { clauses, pairs };
}

/** Aspects mentioned anywhere in a folded clause (sentiment aside). */
export function clauseAspects(foldedClause: string): Aspect[] {
  return ASPECTS.filter((a) => ASPECT_KEYWORDS[a].some((k) => foldedKeywordMatch(foldedClause, k)));
}
