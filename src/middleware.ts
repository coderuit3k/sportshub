import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-only-secret-change-in-production-32chars");

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("sportshub_session")?.value;
  if (!token) return NextResponse.redirect(new URL("/login", req.url));
  try {
    const { payload } = await jwtVerify(token, secret);
    const role = String(payload.role ?? "");
    const path = req.nextUrl.pathname;
    if (path.startsWith("/admin") && role !== "ADMIN") return NextResponse.redirect(new URL("/", req.url));
    if (path.startsWith("/owner") && role !== "OWNER" && role !== "ADMIN") return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
}
export const config = { matcher: ["/my-bookings/:path*", "/profile/:path*", "/owner/:path*", "/admin/:path*", "/favorites/:path*", "/notifications/:path*"] };
