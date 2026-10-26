import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/auth/register — self-registration role choice.
 *
 * Prisma and the session helpers are mocked; the register rate limiter
 * is stubbed to always allow (its own buckets are covered by the
 * rate-limit suites). The rules under test: `role` is optional and
 * defaults to PLAYER; OWNER self-registration is accepted; ADMIN (or
 * any other value) is a 400 and never reaches the database — ADMIN can
 * only be granted later from the admin panel.
 */

interface CreatedUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
}

const state = vi.hoisted(() => ({
  users: [] as CreatedUser[],
  createdWith: [] as Array<Omit<CreatedUser, "id">>,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) =>
        state.users.find((u) => u.email === where.email) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Omit<CreatedUser, "id"> }) => {
        state.createdWith.push(data);
        const user: CreatedUser = { id: `user-${state.users.length + 1}`, ...data };
        state.users.push(user);
        return user;
      }),
    },
    userPreference: {
      create: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  createSessionToken: vi.fn(async (userId: string, role: string) => `token:${userId}:${role}`),
  setSessionCookie: vi.fn(async () => {}),
}));

vi.mock("@/lib/rate-limit", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
  registerLimiter: { consume: vi.fn(async () => ({ allowed: true })) },
  tooManyRequests: vi.fn(
    () => new Response(JSON.stringify({ error: "too many" }), { status: 429 }),
  ),
}));

import { POST } from "@/app/api/auth/register/route";

function registerRequest(body: unknown) {
  return new Request("http://test/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE = { name: "Nguyen Van A", email: "a@example.com", password: "password-123" };

beforeEach(() => {
  state.users = [];
  state.createdWith = [];
});

describe("POST /api/auth/register role choice", () => {
  it("defaults to PLAYER when no role is sent", async () => {
    const res = await POST(registerRequest(BASE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "user-1", role: "PLAYER" });
    expect(state.createdWith).toHaveLength(1);
    expect(state.createdWith[0].role).toBe("PLAYER");
  });

  it("accepts an explicit PLAYER", async () => {
    const res = await POST(registerRequest({ ...BASE, role: "PLAYER" }));
    expect(res.status).toBe(200);
    expect(state.createdWith[0].role).toBe("PLAYER");
  });

  it("accepts OWNER self-registration", async () => {
    const res = await POST(registerRequest({ ...BASE, role: "OWNER" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "user-1", role: "OWNER" });
    expect(state.createdWith[0].role).toBe("OWNER");
  });

  it("rejects ADMIN with 400 and creates nothing", async () => {
    const res = await POST(registerRequest({ ...BASE, role: "ADMIN" }));
    expect(res.status).toBe(400);
    expect(state.createdWith).toHaveLength(0);
    expect(state.users).toHaveLength(0);
  });

  it("rejects any other role value with 400", async () => {
    for (const role of ["SUPERADMIN", "player", ""]) {
      const res = await POST(registerRequest({ ...BASE, role }));
      expect(res.status, role).toBe(400);
    }
    expect(state.createdWith).toHaveLength(0);
  });

  it("still rejects a duplicate email with 409", async () => {
    expect((await POST(registerRequest(BASE))).status).toBe(200);
    const res = await POST(registerRequest({ ...BASE, name: "Another Person" }));
    expect(res.status).toBe(409);
    expect(state.createdWith).toHaveLength(1);
  });
});
