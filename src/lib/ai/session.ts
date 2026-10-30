/**
 * Conversation ownership for the AI assistant.
 *
 * A conversationId is NOT an authorization token. Every turn runs
 * under a server-derived principal:
 * - logged-in users: `user:<id>` from the verified session cookie;
 * - anonymous visitors: `anon:<uuid>` from a dedicated HMAC-signed
 *   httpOnly cookie minted by the server (never from the request
 *   body, never the client IP).
 *
 * The orchestrator scopes its conversation store by principal, so a
 * stored conversation is only visible to its owner.
 *
 * Client-carried context (state + history, needed because serverless
 * instances are ephemeral) is additionally bound by a signed context
 * token the server issues after every turn:
 *   token = base64url({v, cid, principal, state, historyHash, exp})
 *           + "." + HMAC-SHA256(secret, payload)
 * The route only forwards client context to the orchestrator when
 * the token verifies for THIS principal, THIS conversation id, the
 * exact state object and the exact history (by hash). Any tampering
 * — or a token replayed under another principal — makes the carried
 * context be ignored entirely (a fresh conversation starts); it is
 * never partially trusted, and history is never treated as system
 * instructions.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const AI_ANON_COOKIE = "sh_ai_session";
const CONTEXT_TTL_MS = 2 * 60 * 60 * 1000; // matches conversation TTL

function secret(): Buffer {
  return Buffer.from(process.env.AUTH_SECRET ?? "dev-only-secret-change-in-production-32chars", "utf8");
}

function hmac(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/* ------------------------- anonymous principal ------------------------ */

export interface AnonPrincipal {
  principal: string;
  /** Cookie value to (re)set when `isNew` is true. */
  cookieValue: string;
  isNew: boolean;
}

export function resolveAnonPrincipal(cookieValue: string | undefined): AnonPrincipal {
  if (cookieValue) {
    const parts = cookieValue.split(".");
    if (parts.length === 3 && parts[0] === "v1") {
      const [, uuid, sig] = parts;
      if (safeEqual(sig, hmac(`anon:${uuid}`))) {
        return { principal: `anon:${uuid}`, cookieValue, isNew: false };
      }
    }
  }
  const uuid = randomUUID();
  return { principal: `anon:${uuid}`, cookieValue: `v1.${uuid}.${hmac(`anon:${uuid}`)}`, isNew: true };
}

/* --------------------------- context token ---------------------------- */

export interface ContextTokenPayload {
  v: 1;
  cid: string;
  principal: string;
  state: unknown;
  historyHash: string;
  exp: number;
}

export function historyHash(history: { role: string; content: string }[]): string {
  return createHash("sha256").update(JSON.stringify(history)).digest("hex");
}

export function signContextToken(args: {
  conversationId: string;
  principal: string;
  state: unknown;
  history: { role: string; content: string }[];
  nowMs?: number;
}): string {
  const payload: ContextTokenPayload = {
    v: 1,
    cid: args.conversationId,
    principal: args.principal,
    state: args.state,
    historyHash: historyHash(args.history),
    exp: (args.nowMs ?? Date.now()) + CONTEXT_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${hmac(body)}`;
}

export function verifyContextToken(
  token: string | undefined,
  expected: {
    conversationId: string | undefined;
    principal: string;
    state: unknown;
    history: { role: string; content: string }[] | undefined;
    nowMs?: number;
  },
): boolean {
  if (!token || !expected.conversationId) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, hmac(body))) return false;
  let payload: ContextTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ContextTokenPayload;
  } catch {
    return false;
  }
  if (payload.v !== 1) return false;
  if (payload.exp <= (expected.nowMs ?? Date.now())) return false;
  if (payload.cid !== expected.conversationId) return false;
  if (payload.principal !== expected.principal) return false;
  // The carried state must be EXACTLY the state the server last
  // issued (canonical comparison), and the carried history must hash
  // to the server-issued history — edited slots or injected history
  // lines invalidate the whole payload.
  if (JSON.stringify(payload.state) !== JSON.stringify(expected.state)) return false;
  if (payload.historyHash !== historyHash(expected.history ?? [])) return false;
  return true;
}
