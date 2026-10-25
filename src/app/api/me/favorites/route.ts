import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * The current visitor's favorite venue ids, for client-side hydration.
 *
 * The public pages (home, venue detail) are rendered WITHOUT user context
 * so their data can be cached; the favorite hearts/buttons hydrate from
 * this endpoint after mount (see src/components/use-favorites.ts).
 *
 * Response contract (chosen deliberately): always 200 —
 * `{ authenticated: false, venueIds: [] }` for anonymous visitors,
 * `{ authenticated: true, venueIds: [...] }` when signed in. No 401: the
 * endpoint reveals nothing sensitive (an anonymous answer is empty), and
 * clients need no error handling for the anonymous case. Favorite
 * *mutations* still go through POST /api/favorites (401 for anonymous).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ authenticated: false, venueIds: [] as string[] });
  const favorites = await prisma.favorite.findMany({ where: { userId: user.id }, select: { venueId: true } });
  return NextResponse.json({ authenticated: true, venueIds: favorites.map((f) => f.venueId) });
}
