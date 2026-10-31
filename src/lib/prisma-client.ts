import { PrismaPg } from "@prisma/adapter-pg";
import { parse } from "pg-connection-string";
import { PrismaClient } from "../generated/prisma/client";

export function postgresOptions(value: string | undefined) {
  let url: URL;
  try { url = new URL(value ?? ""); }
  catch { throw new Error("DATABASE_URL must be a PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URL must be a PostgreSQL URL");
  const schema = url.searchParams.get("schema") ?? "public";
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error("Invalid PostgreSQL schema");
  let tls: ReturnType<typeof parse>["ssl"];
  try { tls = parse(url.toString()).ssl; }
  catch { throw new Error("Invalid PostgreSQL TLS configuration"); }
  if (tls === "no-verify" || (typeof tls === "object" && tls?.rejectUnauthorized === false)
    || (tls === undefined && process.env.PGSSLMODE === "no-verify")
    || url.searchParams.getAll("sslaccept").includes("accept_invalid_certs")) {
    throw new Error("TLS verification must not be disabled");
  }
  const max = Number(url.searchParams.get("connection_limit") ?? 10);
  const connectionTimeoutMillis = Number(url.searchParams.get("connect_timeout") ?? 5) * 1000;
  if (!Number.isSafeInteger(max) || max <= 0 || !Number.isSafeInteger(connectionTimeoutMillis)
    || connectionTimeoutMillis <= 0 || connectionTimeoutMillis > 2_147_483_647) {
    throw new Error("Invalid PostgreSQL connection setting");
  }
  const options = `${url.searchParams.get("options") ?? ""} -c search_path="${schema}",public`.trim();
  url.searchParams.delete("schema");
  url.searchParams.delete("connection_limit");
  url.searchParams.delete("connect_timeout");
  // pg parses URL options after PoolConfig, so both must carry the isolated search path.
  url.searchParams.set("options", options);
  return { schema, pool: { connectionString: url.toString(), options, max, connectionTimeoutMillis } };
}

export function createPrismaClient(value = process.env.DATABASE_URL) {
  return new PrismaClient({ adapter: {
    provider: "postgres",
    adapterName: "@prisma/adapter-pg",
    async connect() {
      const { pool, schema } = postgresOptions(value);
      return new PrismaPg(pool, { schema }).connect();
    },
  } });
}
