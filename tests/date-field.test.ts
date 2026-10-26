import { describe, expect, it } from "vitest";
import { isoToDisplay, parseDisplayDate } from "@/components/DateField";

/**
 * DateField display/parse helpers: the widget and the homepage search
 * show dd/MM/yyyy while the value everywhere else stays ISO yyyy-mm-dd.
 * Parsing is strict — only real calendar dates survive.
 */
describe("DateField date helpers", () => {
  it("renders ISO as dd/MM/yyyy", () => {
    expect(isoToDisplay("2026-10-26")).toBe("26/10/2026");
    expect(isoToDisplay("2027-01-05")).toBe("05/01/2027");
    expect(isoToDisplay("")).toBe("");
    expect(isoToDisplay("26/10/2026")).toBe("");
  });

  it("parses dd/MM/yyyy back to ISO", () => {
    expect(parseDisplayDate("26/10/2026")).toBe("2026-10-26");
    expect(parseDisplayDate("05/01/2027")).toBe("2027-01-05");
  });

  it("rejects dates that do not exist", () => {
    expect(parseDisplayDate("31/02/2026")).toBeNull();
    expect(parseDisplayDate("29/02/2026")).toBeNull(); // 2026 is not a leap year
    expect(parseDisplayDate("29/02/2028")).toBe("2028-02-29"); // 2028 is
    expect(parseDisplayDate("31/04/2026")).toBeNull();
    expect(parseDisplayDate("00/10/2026")).toBeNull();
    expect(parseDisplayDate("26/13/2026")).toBeNull();
  });

  it("rejects anything that is not strict dd/MM/yyyy", () => {
    expect(parseDisplayDate("2026-10-26")).toBeNull();
    expect(parseDisplayDate("1/1/2026")).toBeNull();
    expect(parseDisplayDate("26/10/26")).toBeNull();
    expect(parseDisplayDate("")).toBeNull();
    expect(parseDisplayDate("abc")).toBeNull();
  });
});
