/**
 * Curated venue photos, keyed by sport slug.
 *
 * Sources: Unsplash and Pexels, served as direct CDN links
 * (images.unsplash.com / images.pexels.com) — hand-picked and verified one
 * by one (HTTP 200 + image content type on the exact URL below, and a
 * visual check that the photo actually shows the sport's venue). No API
 * key, no runtime API calls, no DB column: the same pattern as SportIcon's
 * slug-keyed emoji map, so it works for venues seeded before this map
 * existed and needs no re-seed.
 *
 * Every sport now has two verified photos; callers fall back to the
 * gradient + sport-emoji banner only for unknown slugs (see VenueImage).
 */
const VENUE_IMAGES: Record<string, string[]> = {
  // Cầu lông — shuttlecock in flight, close-up against a dark court
  // background; shuttlecock resting on a green court line, top-down.
  "cau-long": [
    "https://images.unsplash.com/photo-1614058585449-0aceebe022cc?auto=format&fit=crop&w=1200&q=80",
    "https://images.pexels.com/photos/7438732/pexels-photo-7438732.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
  // Pickleball — empty blue/green courts seen from the net post; aerial
  // view of a pickleball complex with games in progress.
  pickleball: [
    "https://images.pexels.com/photos/29820786/pexels-photo-29820786.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/37143606/pexels-photo-37143606.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
  // Bóng đá mini — caged artificial-turf mini pitch with floodlights;
  // outdoor hard-court futsal pitch with a goal.
  "bong-da-mini": [
    "https://images.pexels.com/photos/36681531/pexels-photo-36681531.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/28271652/pexels-photo-28271652.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
  // Quần vợt — white lines on a clay tennis court; outdoor hard court
  // with net, umpire chair and floodlights.
  "quan-vot": [
    "https://images.unsplash.com/photo-1465125672495-63cdc2fa22ed?auto=format&fit=crop&w=1200&q=80",
    "https://images.pexels.com/photos/35564300/pexels-photo-35564300.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
  // Bóng rổ — outdoor hoop/backboard against a clear sky; basketball close-up.
  "bong-ro": [
    "https://images.unsplash.com/photo-1494199505258-5f95387f933c?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1516802273409-68526ee1bdd6?auto=format&fit=crop&w=1200&q=80",
  ],
  // Bơi lội — indoor lap pool with red/blue lane ropes; lane ropes on a
  // turquoise lap pool, close detail.
  "boi-loi": [
    "https://images.pexels.com/photos/40068492/pexels-photo-40068492.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/19073612/pexels-photo-19073612.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
};

/** Stable djb2 hash — the same venue slug always picks the same photo. */
function stableHash(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Photo URL for a venue, chosen deterministically from its primary sport's
 * photos by hashing the venue slug (different venues of the same sport can
 * show different photos; a given venue's photo never changes between loads).
 * Returns null when the sport is unknown or has no verified photo.
 */
export function venueImage(
  primarySportSlug: string | null | undefined,
  venueSlug: string,
): string | null {
  if (!primarySportSlug) return null;
  const urls = VENUE_IMAGES[primarySportSlug];
  if (!urls || urls.length === 0) return null;
  return urls[stableHash(venueSlug) % urls.length];
}
