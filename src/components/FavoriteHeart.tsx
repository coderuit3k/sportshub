"use client";

import { Heart } from "lucide-react";
import { useFavoriteIds } from "@/components/use-favorites";

/**
 * Favorite indicator heart for venue cards (display-only; toggling lives
 * on the venue detail page). The server renders `initial` (always false
 * on cacheable public pages, the real value on per-user pages); after
 * mount, the visitor's favorites hydrate from /api/me/favorites and the
 * heart corrects itself for signed-in users. Anonymous visitors and
 * failed fetches leave `initial` untouched.
 */
export default function FavoriteHeart({ venueId, initial }: { venueId: string; initial: boolean }) {
  const result = useFavoriteIds();
  const isFavorite = result?.authenticated ? result.venueIds.includes(venueId) : initial;
  if (!isFavorite) return null;
  return <Heart className="absolute left-3 top-3 z-10 h-5 w-5 fill-red-500 text-red-500" />;
}
