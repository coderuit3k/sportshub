import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

test("server route traces include the Vercel Prisma runtime engine", () => {
  const buildDir = process.env.SPORTSHUB_E2E_BUILD === "1" ? ".next-e2e" : ".next";
  for (const route of ["api/health/route", "venues/page"]) {
    const tracePath = resolve(buildDir, "server/app", `${route}.js.nft.json`);
    const trace = JSON.parse(readFileSync(tracePath, "utf8")) as { files: string[] };
    const engine = trace.files.find((file) => basename(file) === "libquery_engine-rhel-openssl-3.0.x.so.node");
    expect(engine, `${route} must package the Vercel engine`).toBeDefined();
    expect(existsSync(resolve(dirname(tracePath), engine!))).toBe(true);
  }
});
