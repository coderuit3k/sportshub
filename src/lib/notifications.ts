import { prisma } from "./db";
/** Create a notification, deduped by dedupeKey (idempotent retries won't duplicate). */
export async function notify(userId: string, type: string, title: string, body: string, relatedId?: string, dedupeKey?: string) {
  try {
    await prisma.notification.create({ data: { userId, type, title, body, relatedId, dedupeKey } });
  } catch {
    // unique dedupeKey collision = already notified; swallow intentionally
  }
}
