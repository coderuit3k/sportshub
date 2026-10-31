import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { apiGlobalLimiter, getClientIp, tooManyRequests } from "@/lib/rate-limit";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-only-secret-change-in-production-32chars");

/** Uptime/readiness probe — never throttled (see the API branch below). */
const HEALTH_PATH = "/api/health";

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (path === "/api" || path.startsWith("/api/")) {
    // Global API safety net: EVERY /api/* request consumes from a per-IP
    // fixed-window bucket (600 / 10 min) before any handler runs, so no
    // route — present or future — is ever without a brake. Handlers add
    // their own stricter per-user buckets on top (see src/lib/rate-limit.ts
    // for the classification). The limiter fails soft exactly like the
    // handler-level ones: a Redis error logs loudly and degrades that call
    // to per-instance memory instead of failing the request.
    //
    // Middleware is the only layer that covers /api/* totally by
    // construction; it must never run the page auth guard below for API
    // paths (API routes answer their own 401 JSON, never a redirect).
    if (path !== HEALTH_PATH) {
      const gate = await apiGlobalLimiter.consume(`api:${getClientIp(req)}`);
      if (!gate.allowed) return tooManyRequests(gate);
    }
    return NextResponse.next();
  }

  const token = req.cookies.get("sportshub_session")?.value;
  if (!token) return NextResponse.redirect(new URL("/login", req.url));
  try {
    const { payload } = await jwtVerify(token, secret);
    const role = String(payload.role ?? "");
    if (path.startsWith("/admin") && role !== "ADMIN") return NextResponse.redirect(new URL("/", req.url));
    if (path.startsWith("/owner") && role !== "OWNER" && role !== "ADMIN") return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
}
export const config = { matcher: ["/my-bookings/:path*", "/profile/:path*", "/owner/:path*", "/admin/:path*", "/favorites/:path*", "/notifications/:path*", "/api/:path*"] };
