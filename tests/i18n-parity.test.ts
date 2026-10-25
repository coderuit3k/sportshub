import { describe, expect, it } from "vitest";
import vi from "../messages/vi.json";
import en from "../messages/en.json";

/**
 * Dictionary parity guard: vi.json and en.json must expose the exact same
 * key set (arrays compared element-wise). Any drift fails loudly here so
 * a missing translation can't slip in as a raw key at runtime.
 */
function flatten(node: unknown, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(node)) {
    node.forEach((item, i) => flatten(item, prefix ? `${prefix}.${i}` : `${i}`, out));
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.set(prefix, node);
  }
  return out;
}

describe("i18n dictionary parity (vi ↔ en)", () => {
  const viFlat = flatten(vi);
  const enFlat = flatten(en);

  it("has identical key sets in both locales", () => {
    const onlyVi = [...viFlat.keys()].filter((k) => !enFlat.has(k));
    const onlyEn = [...enFlat.keys()].filter((k) => !viFlat.has(k));
    expect({ onlyVi, onlyEn }).toEqual({ onlyVi: [], onlyEn: [] });
    expect(viFlat.size).toBeGreaterThan(0);
    expect(enFlat.size).toBe(viFlat.size);
  });

  it("has a non-empty string for every leaf in both locales", () => {
    for (const [locale, flat] of [["vi", viFlat], ["en", enFlat]] as const) {
      for (const [key, value] of flat) {
        expect(typeof value, `${locale}:${key} should be a string`).toBe("string");
        expect((value as string).trim().length, `${locale}:${key} should not be empty`).toBeGreaterThan(0);
      }
    }
  });

  it("uses the same ICU placeholders for every key", () => {
    const placeholders = (s: unknown) =>
      typeof s === "string" ? [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort() : [];
    for (const key of viFlat.keys()) {
      expect(placeholders(enFlat.get(key)), `placeholders differ for ${key}`).toEqual(
        placeholders(viFlat.get(key)),
      );
    }
  });
});
