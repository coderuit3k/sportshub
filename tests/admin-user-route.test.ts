import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/admin/users/[id] — admin user management.
 *
 * Prisma and the session are mocked; the generic-write limiter is
 * stubbed to always allow (limiter wiring is covered by the rate-limit
 * coverage suite). Under test here: the `set-role` action — the ONLY
 * path that can grant ADMIN. It requires an ADMIN session, accepts
 * PLAYER/OWNER/ADMIN, refuses to change the acting admin's OWN role,
 * and writes a USER_ROLE_CHANGED audit entry. Existing actions
 * (set-password) keep working through the same discriminated union.
 */

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  passwordHash: string;
}

interface AuditRow {
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  details?: string;
}

const state = vi.hoisted(() => ({
  currentUser: null as { id: string; role: string } | null,
  users: [] as UserRow[],
  audit: [] as AuditRow[],
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => state.currentUser),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.users.find((u) => u.id === where.id) ?? null,
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
          const user = state.users.find((u) => u.id === where.id);
          if (user) Object.assign(user, data);
          return user;
        },
      ),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: AuditRow }) => {
        state.audit.push(data);
        return data;
      }),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  genericWriteLimiter: { consume: vi.fn(async () => ({ allowed: true })) },
  tooManyRequests: vi.fn(
    () => new Response(JSON.stringify({ error: "too many" }), { status: 429 }),
  ),
}));

import { POST } from "@/app/api/admin/users/[id]/route";

const ADMIN = { id: "admin-1", role: "ADMIN" };

function seedUsers() {
  state.users = [
    { id: "admin-1", name: "Root Admin", email: "admin@sportshub.local", role: "ADMIN", passwordHash: "h-admin" },
    { id: "player-9", name: "Player Nine", email: "player9@example.com", role: "PLAYER", passwordHash: "h-9" },
    { id: "owner-2", name: "Owner Two", email: "owner2@example.com", role: "OWNER", passwordHash: "h-2" },
  ];
  state.audit = [];
}

function adminRequest(id: string, body: unknown) {
  const req = new Request(`http://test/api/admin/users/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

const target = (id: string) => state.users.find((u) => u.id === id);

beforeEach(() => {
  state.currentUser = null;
  seedUsers();
});

describe("POST /api/admin/users/[id] set-role", () => {
  it("requires an ADMIN session", async () => {
    state.currentUser = null;
    expect((await adminRequest("player-9", { action: "set-role", role: "OWNER" })).status).toBe(403);
    state.currentUser = { id: "player-9", role: "PLAYER" };
    expect((await adminRequest("owner-2", { action: "set-role", role: "PLAYER" })).status).toBe(403);
    state.currentUser = { id: "owner-2", role: "OWNER" };
    expect((await adminRequest("player-9", { action: "set-role", role: "ADMIN" })).status).toBe(403);
    expect(target("player-9")?.role).toBe("PLAYER");
    expect(state.audit).toHaveLength(0);
  });

  it("promotes a PLAYER to OWNER and audits it", async () => {
    state.currentUser = ADMIN;
    const res = await adminRequest("player-9", { action: "set-role", role: "OWNER" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action: "set-role", userId: "player-9", role: "OWNER" });
    expect(target("player-9")?.role).toBe("OWNER");
    expect(state.audit).toEqual([
      {
        actorId: "admin-1",
        action: "USER_ROLE_CHANGED",
        entity: "User",
        entityId: "player-9",
        details: "player9@example.com: PLAYER → OWNER",
      },
    ]);
  });

  it("grants ADMIN — the only path that can", async () => {
    state.currentUser = ADMIN;
    const res = await adminRequest("owner-2", { action: "set-role", role: "ADMIN" });
    expect(res.status).toBe(200);
    expect(target("owner-2")?.role).toBe("ADMIN");
    expect(state.audit[0]).toMatchObject({ action: "USER_ROLE_CHANGED", entityId: "owner-2" });
  });

  it("demotes an OWNER back to PLAYER", async () => {
    state.currentUser = ADMIN;
    const res = await adminRequest("owner-2", { action: "set-role", role: "PLAYER" });
    expect(res.status).toBe(200);
    expect(target("owner-2")?.role).toBe("PLAYER");
  });

  it("rejects an admin changing their OWN role (400, nothing changes)", async () => {
    state.currentUser = ADMIN;
    const res = await adminRequest("admin-1", { action: "set-role", role: "PLAYER" });
    expect(res.status).toBe(400);
    expect(target("admin-1")?.role).toBe("ADMIN");
    expect(state.audit).toHaveLength(0);
  });

  it("rejects an unknown role with 400 and creates no audit entry", async () => {
    state.currentUser = ADMIN;
    const res = await adminRequest("player-9", { action: "set-role", role: "SUPERADMIN" });
    expect(res.status).toBe(400);
    expect(target("player-9")?.role).toBe("PLAYER");
    expect(state.audit).toHaveLength(0);
  });

  it("404s for a missing target user", async () => {
    state.currentUser = ADMIN;
    const res = await adminRequest("nope", { action: "set-role", role: "OWNER" });
    expect(res.status).toBe(404);
  });

  it("keeps same-role assignments a no-op success", async () => {
    state.currentUser = ADMIN;
    const res = await adminRequest("player-9", { action: "set-role", role: "PLAYER" });
    expect(res.status).toBe(200);
    expect(target("player-9")?.role).toBe("PLAYER");
  });
});

describe("POST /api/admin/users/[id] existing actions still work", () => {
  it("set-password updates the hash and audits USER_PASSWORD_RESET", async () => {
    state.currentUser = ADMIN;
    const res = await adminRequest("player-9", { action: "set-password", password: "brand-new-password" });
    expect(res.status).toBe(200);
    expect(target("player-9")?.passwordHash).not.toBe("h-9");
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ action: "USER_PASSWORD_RESET", entityId: "player-9" });
  });

  it("set-password still enforces the 10-character minimum", async () => {
    state.currentUser = ADMIN;
    const res = await adminRequest("player-9", { action: "set-password", password: "short" });
    expect(res.status).toBe(400);
    expect(target("player-9")?.passwordHash).toBe("h-9");
  });

  it("rejects an unknown action with 400", async () => {
    state.currentUser = ADMIN;
    const res = await adminRequest("player-9", { action: "delete" });
    expect(res.status).toBe(400);
  });
});
