import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Route-coverage manifest for rate limiting.
 *
 * Every route under src/app/api must appear in MANIFEST with a rate-limit
 * classification, and the classification must be REAL: when a route is
 * claimed by a handler-level bucket, its source must import that limiter;
 * the global per-IP net must be wired in middleware (matcher covers
 * /api/*, /api/health exempt). Adding a new API route without updating
 * this manifest fails the suite — that is the point: no route ships
 * unclassified.
 *
 * Classification rule (docs/architecture.md → "Rate limiting"): every
 * request under /api/* counts against the global per-IP net in
 * middleware; each mutation is additionally claimed by exactly ONE
 * per-user bucket (its specific bucket when one exists, otherwise the
 * generic write bucket) and is never double-counted into the generic
 * bucket. The only mutations with no per-user bucket are POST
 * /api/auth/logout (it must work with an expired/absent session, so
 * there is no trustworthy user id to key on — the global net covers
 * it) and POST /api/owner/venue-photo/upload (it only ISSUES a
 * presigned R2 upload URL — the file bytes go browser → Cloudflare
 * R2 directly and the database write happens on
 * POST /api/owner/venue-photo, which IS claimed by the generic
 * write bucket).
 */

const API_DIR = path.resolve(process.cwd(), "src/app/api");
const MIDDLEWARE = path.resolve(process.cwd(), "src/proxy.ts");
const MUTATIONS = ["POST", "PUT", "PATCH", "DELETE"];

interface Classification {
  methods: string[];
  /** Limiter symbol the handler itself must import from @/lib/rate-limit, or null. */
  handlerLimiter: string | null;
}

const MANIFEST: Record<string, Classification> = {
  "/api/health": { methods: ["GET"], handlerLimiter: null }, // exempt even from the global net
  "/api/availability": { methods: ["GET"], handlerLimiter: null }, // read-only → global net only
  "/api/me/favorites": { methods: ["GET"], handlerLimiter: null }, // read-only → global net only
  "/api/auth/login": { methods: ["POST"], handlerLimiter: "loginLimiter" },
  "/api/auth/register": { methods: ["POST"], handlerLimiter: "registerLimiter" },
  "/api/auth/logout": { methods: ["POST"], handlerLimiter: null }, // documented exception (see header)
  "/api/bookings": { methods: ["POST"], handlerLimiter: "bookingLimiter" },
  "/api/bookings/[id]/action": { methods: ["POST"], handlerLimiter: "genericWriteLimiter" },
  "/api/sessions": { methods: ["POST"], handlerLimiter: "sessionCreateLimiter" },
  "/api/sessions/[id]/join": { methods: ["POST"], handlerLimiter: "sessionJoinLimiter" },
  "/api/favorites": { methods: ["POST"], handlerLimiter: "genericWriteLimiter" },
  "/api/profile": { methods: ["PATCH"], handlerLimiter: "genericWriteLimiter" },
  "/api/profile/change-password": { methods: ["POST"], handlerLimiter: "passwordChangeLimiter" },
  "/api/admin/users/[id]": { methods: ["POST"], handlerLimiter: "genericWriteLimiter" },
  "/api/admin/venues/[id]": { methods: ["POST"], handlerLimiter: "genericWriteLimiter" },
  // Venue photos (Cloudflare R2): the upload route only issues a
  // presigned PUT URL — no write of its own → global net only (see
  // header). The persist/remove route performs the actual DB write
  // → generic bucket.
  "/api/owner/venue-photo/upload": { methods: ["POST"], handlerLimiter: null },
  "/api/owner/venue-photo": { methods: ["POST", "DELETE"], handlerLimiter: "genericWriteLimiter" },
  // AI assistant chat: no business mutation, but each turn fans out to
  // tool executions + a paid model call → its own dedicated bucket
  // (per user when logged in, per IP otherwise), consumed in-handler.
  "/api/assistant": { methods: ["POST"], handlerLimiter: "aiAssistantLimiter" },
};

/** Routes allowed to mutate with no per-user bucket (global net only). */
const GLOBAL_ONLY_MUTATIONS = ["/api/auth/logout", "/api/owner/venue-photo/upload"];

function discoverRoutes(dir: string, prefix: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [k, v] of discoverRoutes(full, `${prefix}/${entry.name}`)) found.set(k, v);
    } else if (entry.name === "route.ts") {
      found.set(prefix || "/api", full);
    }
  }
  return found;
}

const routes = discoverRoutes(API_DIR, "/api");

describe("rate-limit route coverage manifest", () => {
  it("classifies every route under src/app/api — no more, no fewer", () => {
    expect([...routes.keys()].sort()).toEqual(Object.keys(MANIFEST).sort());
  });

  it("each route exports exactly the methods its classification declares", () => {
    for (const [route, file] of routes) {
      const src = readFileSync(file, "utf8");
      const exported = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
      expect({ route, exported }).toEqual({ route, exported: [...MANIFEST[route].methods].sort() });
    }
  });

  it("routes claimed by a handler bucket actually import and consume that limiter", () => {
    for (const [route, file] of routes) {
      const { handlerLimiter } = MANIFEST[route];
      if (!handlerLimiter) continue;
      const src = readFileSync(file, "utf8");
      expect(src, `${route} must import ${handlerLimiter}`).toContain(handlerLimiter);
      expect(src, `${route} must consume ${handlerLimiter}`).toMatch(
        new RegExp(`${handlerLimiter}\\.(consume|check|record)`),
      );
      expect(src, `${route} must answer 429 via tooManyRequests`).toContain("tooManyRequests");
    }
  });

  it("no mutation route lacks a per-user bucket except the documented exceptions", () => {
    for (const [route, cls] of Object.entries(MANIFEST)) {
      const mutates = cls.methods.some((m) => MUTATIONS.includes(m));
      if (mutates && cls.handlerLimiter === null) {
        expect(GLOBAL_ONLY_MUTATIONS).toContain(route);
      }
    }
  });

  it("specific-bucket routes are not double-counted into the generic write bucket", () => {
    const specific = ["loginLimiter", "registerLimiter", "bookingLimiter", "sessionCreateLimiter", "sessionJoinLimiter", "passwordChangeLimiter"];
    for (const [route, file] of routes) {
      const { handlerLimiter } = MANIFEST[route];
      if (handlerLimiter && specific.includes(handlerLimiter)) {
        const src = readFileSync(file, "utf8");
        expect(src, `${route} must not also consume genericWriteLimiter`).not.toContain("genericWriteLimiter");
      }
    }
  });
});

describe("global API safety net (middleware)", () => {
  const src = readFileSync(MIDDLEWARE, "utf8");

  it("middleware matches /api/* so the net covers every API route by construction", () => {
    expect(src).toContain('"/api/:path*"');
  });

  it("middleware consumes the global per-IP limiter and answers with the shared 429 contract", () => {
    expect(src).toContain("apiGlobalLimiter");
    expect(src).toMatch(/apiGlobalLimiter\.consume\(/);
    expect(src).toContain("getClientIp");
    expect(src).toContain("tooManyRequests");
  });

  it("middleware exempts /api/health from the net", () => {
    expect(src).toContain('"/api/health"');
  });

  it("middleware never runs the page auth guard for API paths (no redirects for /api)", () => {
    // The API branch must return before the session-cookie redirect logic:
    // structurally, the /api branch appears before the sportshub_session read.
    const apiBranch = src.indexOf('startsWith("/api/")');
    const cookieRead = src.indexOf('req.cookies.get("sportshub_session")');
    expect(apiBranch).toBeGreaterThan(-1);
    expect(cookieRead).toBeGreaterThan(apiBranch);
  });
});

describe("review-create bucket reservation", () => {
  it("no review-creation route exists yet (reviews are seed data)", () => {
    expect([...routes.keys()].some((r) => r.includes("review"))).toBe(false);
    expect(existsSync(path.join(API_DIR, "reviews"))).toBe(false);
  });

  it("the reserved reviewCreateLimiter is defined in the rate-limit module", () => {
    const src = readFileSync(path.resolve(process.cwd(), "src/lib/rate-limit.ts"), "utf8");
    expect(src).toContain("reviewCreateLimiter");
    expect(src).toContain("sportshub:review-create");
  });
});
