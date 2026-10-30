/**
 * Tool-spec generation (audit E): the schema shown to the model must
 * be derived from the runtime Zod schemas and must carry the
 * information whose absence caused input errors — required fields,
 * enums, numeric bounds and nested shapes — not just field names.
 */
import { describe, expect, it } from "vitest";
import { toolSpecsForPrompt, PROMPT_VERSION } from "@/lib/ai/prompts";

describe("tool specs for the model", () => {
  const specs = toolSpecsForPrompt();

  it("records the current schema-complete prompt version", () => {
    expect(PROMPT_VERSION).toBe("sportshub-assistant-v11");
  });

  it("includes enum values for budget basis and review sources", () => {
    expect(specs).toContain('"per_hour"');
    expect(specs).toContain('"total_session"');
    expect(specs).toContain('"google"');
    expect(specs).toContain('"in_app"');
  });

  it("includes the VND floor that rejects thousands-figures", () => {
    expect(specs).toContain("≥10000");
    expect(specs).toContain("full VND amount");
  });

  it("marks required fields per tool", () => {
    expect(specs).toContain("[required: venueId, date]");
    expect(specs).toContain("[required: venueId, facilityId, date, startTime, durationHours]");
    expect(specs).toContain("[required: venueIds]");
  });

  it("describes nested objects (booking window) instead of hiding them", () => {
    expect(specs).toMatch(/window: \{from:/);
  });

  it("keeps bounds visible (arrays and numeric limits)", () => {
    expect(specs).toContain("(max 3)");
    expect(specs).toContain("≤12");
    expect(specs).toContain("≤6");
  });
});
