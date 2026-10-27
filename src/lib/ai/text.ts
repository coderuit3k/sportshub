/**
 * Vietnamese text helpers for the assistant tools: diacritic folding so
 * "cau long", "Cầu Lông" and "CẦU LÔNG" all match the same stored text.
 * This is lexical matching — it is never described as semantic search.
 */

/** Lowercase + strip Vietnamese diacritics (đ → d included). */
export function foldVi(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/** Folded substring match. */
export function foldedIncludes(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return foldVi(haystack).includes(foldVi(needle));
}

/** Tokenize folded text into words for lexical overlap scoring. */
export function foldTokens(input: string): string[] {
  return foldVi(input)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}
