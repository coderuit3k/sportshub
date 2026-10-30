import { execFileSync } from "node:child_process";
import path from "node:path";
import { rmSync } from "node:fs";
import { createTestDb } from "../tests/db";
import { seedBrowserSession } from "../tests/e2e/seed";

async function main() {
  // Cached public DTOs contain IDs from the previous disposable database.
  const buildDir = path.resolve(".next-e2e");
  rmSync(buildDir, { recursive: true, force: true });
  const fixture = await createTestDb(process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL);
  const env = { ...process.env, DATABASE_URL: fixture.url,
    AUTH_SECRET: "isolated-e2e-secret-at-least-32-characters", NEXT_PUBLIC_APP_URL: "http://localhost:3100",
    ALLOW_DESTRUCTIVE_SEED: "true", AI_ASSISTANT_ENABLED: "true", SPORTSHUB_E2E_BUILD: "1" };
  try {
    execFileSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], { env, stdio: "inherit" });
    await seedBrowserSession(fixture.db);
    execFileSync(process.execPath, [path.resolve("node_modules/@playwright/test/cli.js"), "test", ...process.argv.slice(2)], {
      env, stdio: "inherit",
    });
  } finally {
    try { await fixture.cleanup(); }
    finally { rmSync(buildDir, { recursive: true, force: true }); }
  }
}

main().catch(() => { console.error("E2E setup or Playwright failed; inspect the preceding step output."); process.exitCode = 1; });
