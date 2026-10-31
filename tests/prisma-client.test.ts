import { describe, expect, it, vi } from "vitest";
import { createPrismaClient, postgresOptions } from "../src/lib/prisma-client";

describe("PostgreSQL adapter configuration", () => {
  it("defers missing configuration errors until a connection is actually used", async () => {
    const db = createPrismaClient("");
    try { await expect(db.$connect()).rejects.toThrow("DATABASE_URL must be a PostgreSQL URL"); }
    finally { await db.$disconnect(); }
  });

  it("keeps generated and raw queries on the selected schema with bounded connections", () => {
    const { pool, schema } = postgresOptions("postgresql://user:secret@localhost/app_test?schema=Tenant_1&connection_limit=3&connect_timeout=7");
    expect(schema).toBe("Tenant_1");
    expect(pool.options).toBe('-c search_path="Tenant_1",public');
    expect(pool.max).toBe(3);
    expect(pool.connectionTimeoutMillis).toBe(7000);
    expect(new URL(pool.connectionString).searchParams.has("schema")).toBe(false);
  });

  it("uses public and finite pool/connect defaults without disabling TLS verification", () => {
    const { pool, schema } = postgresOptions("postgresql://localhost/app_test?sslmode=verify-full");
    expect(schema).toBe("public");
    expect(pool.max).toBe(10);
    expect(pool.connectionTimeoutMillis).toBe(5000);
    expect(new URL(pool.connectionString).searchParams.get("sslmode")).toBe("verify-full");
    expect(pool).not.toHaveProperty("ssl");
  });

  it.each([undefined, "password=PRIVATE_MARKER", "file:PRIVATE_MARKER.db"]) ("rejects invalid URLs without disclosing credentials", (value) => {
    expect(() => postgresOptions(value)).toThrow("DATABASE_URL must be a PostgreSQL URL");
  });

  it.each(["public;DROP SCHEMA public", "tenant,public", "tenant name"]) ("rejects unsafe schema identifiers", (schema) => {
    const url = new URL("postgresql://localhost/app_test");
    url.searchParams.set("schema", schema);
    expect(() => postgresOptions(url.toString())).toThrow("Invalid PostgreSQL schema");
  });

  it.each(["connection_limit=0", "connection_limit=1.5", "connect_timeout=-1", "connect_timeout=9999999999"]) ("rejects invalid pool settings", (query) => {
    expect(() => postgresOptions(`postgresql://localhost/app_test?${query}`)).toThrow("Invalid PostgreSQL connection setting");
  });

  it.each(["sslmode=no-verify", "ssl=no-verify", "sslmode=require&uselibpqcompat=true", "sslmode=verify-full&sslmode=no-verify"]) ("rejects every effective no-verify driver configuration", (query) => {
    expect(() => postgresOptions(`postgresql://localhost/app_test?${query}`)).toThrow("TLS verification must not be disabled");
  });

  it("rejects an insecure inherited driver default", () => {
    vi.stubEnv("PGSSLMODE", "no-verify");
    try {
      expect(() => postgresOptions("postgresql://localhost/app_test")).toThrow("TLS verification must not be disabled");
      expect(() => postgresOptions("postgresql://localhost/app_test?sslmode=verify-full")).not.toThrow();
    } finally { vi.unstubAllEnvs(); }
  });

  it("accepts verified libpq TLS semantics", () => {
    expect(() => postgresOptions("postgresql://localhost/app_test?sslmode=verify-full&uselibpqcompat=true")).not.toThrow();
  });
});
