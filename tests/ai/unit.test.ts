/**
 * Pure unit tests for the AI foundation: text folding, the clause
 * aspect/sentiment tagger, stable review identity, and the budget
 * counter. No database involved.
 */
import { describe, expect, it } from "vitest";
import { foldVi, foldedIncludes } from "@/lib/ai/text";
import { splitClauses, tagReview } from "@/lib/ai/aspects";
import { BudgetCounter } from "@/lib/ai/types";
import { stableGoogleReviewId } from "../../prisma/real-catalog";

describe("foldVi", () => {
  it("folds Vietnamese diacritics including đ", () => {
    expect(foldVi("Cầu Lông Thủ Đức")).toBe("cau long thu duc");
    expect(foldVi("Ánh sáng chói")).toBe("anh sang choi");
    expect(foldedIncludes("Sân bóng rổ Quận 7", "bong ro quan 7")).toBe(true);
  });
});

describe("clause aspect/sentiment tagger", () => {
  it("keeps aspect–sentiment pairs inside the same clause (spec example)", () => {
    const { pairs } = tagReview("Sàn trơn nhưng nhân viên nhiệt tình.");
    expect(pairs).toContainEqual({ aspect: "court_surface", sentiment: "negative", clause: "Sàn trơn" });
    const staff = pairs.filter((p) => p.aspect === "staff");
    expect(staff).toHaveLength(1);
    expect(staff[0].sentiment).toBe("positive");
    expect(pairs.some((p) => p.aspect === "staff" && p.sentiment === "negative")).toBe(false);
  });

  it("clauses are exact substrings of the source text", () => {
    const text = "Sân đẹp, giá rẻ. Nhân viên thái độ tệ, vệ sinh kém.";
    for (const clause of splitClauses(text)) expect(text.includes(clause)).toBe(true);
    const { pairs } = tagReview(text);
    expect(pairs.some((p) => p.aspect === "staff" && p.sentiment === "negative")).toBe(true);
    expect(pairs.some((p) => p.aspect === "price_value" && p.sentiment === "positive")).toBe(true);
  });

  it("short keywords do not fire inside unrelated words", () => {
    // "trên" must not tag price_value via "re"; "cũng" must not tag via "cu".
    const { pairs } = tagReview("Sân ở trên đồi, cũng khá xa trung tâm.");
    expect(pairs.filter((p) => p.aspect === "price_value")).toHaveLength(0);
  });
});

describe("stableGoogleReviewId", () => {
  const review = { authorName: "An", relativeTime: "2 tuần trước", text: "Sàn đẹp." };
  it("is deterministic for the same review content", () => {
    expect(stableGoogleReviewId("san-a", review)).toBe(stableGoogleReviewId("san-a", review));
  });
  it("changes when the text is edited (old citations must not silently retarget)", () => {
    expect(stableGoogleReviewId("san-a", review)).not.toBe(
      stableGoogleReviewId("san-a", { ...review, text: "Sàn đẹp lắm." }),
    );
  });
  it("differs across venues and authors", () => {
    expect(stableGoogleReviewId("san-a", review)).not.toBe(stableGoogleReviewId("san-b", review));
    expect(stableGoogleReviewId("san-a", review)).not.toBe(
      stableGoogleReviewId("san-a", { ...review, authorName: "Bình" }),
    );
  });
  it("is an internal key format, not presented as a Google id", () => {
    expect(stableGoogleReviewId("san-a", review)).toMatch(/^gr_[0-9a-f]{32}$/);
  });
});

describe("BudgetCounter", () => {
  it("consumes and refuses past the limit (composite calls included)", () => {
    const b = new BudgetCounter(3);
    expect(b.consume()).toBe(true);
    expect(b.consume(2)).toBe(true);
    expect(b.consume()).toBe(false);
    expect(b.usedCount).toBe(3);
    expect(b.remaining).toBe(0);
  });
});
