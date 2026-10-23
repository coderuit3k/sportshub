import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./db";

export const ROLES = ["PLAYER", "OWNER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];
const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-only-secret-change-in-production-32chars");
export const SESSION_COOKIE = "sportshub_session";

export async function createSessionToken(userId: string, role: string): Promise<string> {
  return new SignJWT({ sub: userId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}
export async function verifySessionToken(token: string): Promise<{ userId: string; role: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sub !== "string") return null;
    return { userId: payload.sub, role: String(payload.role ?? "PLAYER") };
  } catch { return null; }
}
export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7, secure: process.env.NODE_ENV === "production" });
}
export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
export async function getCurrentUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.userId } });
  if (!user || user.status !== "ACTIVE") return null;
  return user;
}
export function hasRole(userRole: string, allowed: Role[]): boolean {
  return allowed.includes(userRole as Role);
}
