import type { PrismaClient, User, Venue } from "../../generated/prisma/client";

/**
 * Who may manage a venue's stored photo (upload / replace / revert):
 * the venue's owner (Venue.ownerId), any staff member attached to
 * the venue (VenueStaff), or an ADMIN. Shared by the venue-photo
 * presign route and the persist/remove route so both enforce exactly
 * the same rule.
 *
 * Returns the venue plus whether the user may manage it, or null
 * when the venue does not exist — callers answer 404 for null and
 * 403 for `allowed: false`.
 */
export async function getVenueForManager(
  prisma: PrismaClient,
  user: Pick<User, "id" | "role">,
  venueId: string,
): Promise<{ venue: Venue; allowed: boolean } | null> {
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    include: { staff: { where: { userId: user.id }, select: { id: true } } },
  });
  if (!venue) return null;
  const allowed =
    user.role === "ADMIN" || venue.ownerId === user.id || venue.staff.length > 0;
  return { venue, allowed };
}
