import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./db";

describe("test database boundary", () => {
  it.each(["file:dev.db", "postgresql://user:secret@localhost/production", "postgresql://user:secret@localhost/test"]) (
    "rejects a non-test destination without disclosing credentials", (value) => {
      expect(() => testDatabaseUrl(value)).toThrow("Tests require a PostgreSQL database whose name ends in _test");
    });
  it("accepts an explicit PostgreSQL test database", () => {
    expect(testDatabaseUrl("postgresql://localhost/sportshub_test").pathname).toBe("/sportshub_test");
  });
  it("does not disclose an invalid connection string", () => {
    expect(() => testDatabaseUrl("password=PRIVATE_MARKER")).toThrow("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  });
});
