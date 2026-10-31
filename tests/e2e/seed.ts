import type { PrismaClient } from "../../src/generated/prisma/client";

/** Browser-only controlled community fixture, created after real-catalog convergence. */
export async function seedBrowserSession(db: PrismaClient) {
  const organizer = await db.user.findUniqueOrThrow({ where: { email: "owner@sportshub.local" } });
  const sport = await db.sport.findUniqueOrThrow({ where: { slug: "cau-long" } });
  const venue = await db.venue.findUniqueOrThrow({ where: { slug: "pooc-cau-long-pickleball" } });
  const startAt = new Date(Date.now() + 24 * 3600_000);
  await db.sportsSession.create({ data: {
    title: "E2E community fixture", description: "Controlled browser-test session, not a real event",
    organizerId: organizer.id, venueId: venue.id, sportId: sport.id, status: "OPEN",
    startAt, endAt: new Date(startAt.getTime() + 3600_000), maxParticipants: 4,
    participants: { create: { userId: organizer.id, status: "JOINED" } },
  } });
}
