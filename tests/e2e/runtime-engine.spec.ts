import { test, expect } from "@playwright/test";
test("production build connects through the PostgreSQL driver adapter", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok", db: "ok" });
  const discovery = await request.get("/venues");
  expect(discovery.status()).toBe(200);
  expect(await discovery.text()).toContain('href="/venues/');
});
