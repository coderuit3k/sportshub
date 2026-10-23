/**
 * Venue photos.
 *
 * Primary strategy: one photo per seed venue, sourced from a REAL
 * Vietnamese sports-facility website of the same sport (the venue
 * operator's own site wherever one exists) — see VENUE_PHOTOS below, each
 * entry names its source website. Every URL was verified individually:
 * HTTP 200 + image content type with our own site sent as Referer
 * (hotlinking must work), the downloaded bytes are a real image, and a
 * visual check confirmed the photo shows that sport's actual court /
 * hall / pool in a wide shot (no equipment close-ups, portraits,
 * text-heavy banners or logos).
 *
 * Fallback: venues without a per-venue photo use the sport-level stock
 * map (Unsplash / Pexels CDN links, verified the same way), picked
 * deterministically by hashing the venue slug; unknown sports return
 * null and VenueImage renders the gradient + sport-emoji banner.
 * No API key, no runtime API calls, no DB column.
 */
const VENUE_PHOTOS: Record<string, string> = {
  // Smash Arena Thủ Đức (badminton, indoor) — Quốc Việt Badminton
  // (qvbadminton.com): wide shot of their own indoor badminton hall in
  // HCMC, green courts in play.
  "smash-arena-thu-duc":
    "https://qvbadminton.com/wp-content/uploads/2024/12/khong-gian-san-cau-long-quoc-viet-badminton-quan-7.jpg",
  // PickleHub Bình Thạnh (pickleball) — CLB Pickleball Trung Đoàn Gia
  // Định (pickleballtrungdoangiadinh.com, the club's own site): match
  // action at the net on their blue indoor court. (HTTP-only host.)
  "pickle-hub-binh-thanh":
    "http://pickleballtrungdoangiadinh.com/upload/news/pk1-1774757208.webp",
  // Hoops Center Thủ Đức (basketball, indoor wooden floor) — 29 Ballers
  // (29ballers.com, a basketball-court booking site; image served from
  // their Supabase storage): empty indoor wooden basketball court.
  "hoops-center-thu-duc":
    "https://mdfajydtdhiuflrkruft.supabase.co/storage/v1/object/public/branches/29/d96072c8-e38b-41c9-83eb-ba697114fc43.jpg",
  // Aqua Pool Quận 7 (swimming) — Tôn Đức Thắng University, Quận 7
  // (international.tdtu.edu.vn): the university's own outdoor pool —
  // 25 m × 13.5 m with 6 lanes per TDTU's facility page, the same spec
  // as this seed venue.
  "aqua-pool-q7":
    "https://international.tdtu.edu.vn/sites/international/files/International/Support/Ho-boi.jpg",
  // New Court Pending Bình Thạnh (badminton + pickleball, indoor) —
  // Quốc Việt Badminton (qvbadminton.com, a badminton & pickleball
  // operator): their empty indoor hall with nets up. The hall's own
  // wall signage is visible, as on any real venue photo.
  "new-court-pending-binh-thanh":
    "https://qvbadminton.com/wp-content/uploads/2024/12/san-cau-long-quoc-viet-quan-7.jpg",
  // No per-venue photo for sai-gon-mini-football-q7 or
  // riverside-tennis-q1: no usable wide shot of a real facility could
  // be verified on a Vietnamese operator's own website (the candidate
  // sites served only stock close-ups, player portraits or text-heavy
  // marketing banners), so both fall through to the sport-level stock
  // map below — see docs/architecture.md, "Venue photos".
};

/**
 * Sport-level stock fallback (Unsplash / Pexels CDN links), keyed by
 * sport slug. Two verified photos per sport; the venue slug hash picks
 * one deterministically.
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
 * Photo URL for a venue: the per-venue real-facility photo when one is
 * mapped, otherwise a deterministic pick from the primary sport's stock
 * photos (stable hash of the venue slug, so a given venue's photo never
 * changes between loads). Returns null when neither applies.
 */
export function venueImage(
  primarySportSlug: string | null | undefined,
  venueSlug: string,
): string | null {
  const perVenue = VENUE_PHOTOS[venueSlug];
  if (perVenue) return perVenue;
  if (!primarySportSlug) return null;
  const urls = VENUE_IMAGES[primarySportSlug];
  if (!urls || urls.length === 0) return null;
  return urls[stableHash(venueSlug) % urls.length];
}
