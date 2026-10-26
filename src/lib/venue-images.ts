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
 * Fallback: venues without a per-venue photo use the sport-level pool
 * (VENUE_IMAGES), picked deterministically by hashing the venue slug.
 * The pools are mostly REAL facility photography too: each pool leads
 * with photos of real courts / halls / pools — Vietnamese operator and
 * sports-guide sites where usable shots could be verified, plus
 * Wikimedia Commons photos of named facilities worldwide (CC-licensed,
 * see docs/architecture.md for the credit note) — and keeps the
 * earlier verified Unsplash / Pexels stock entries as the tail
 * (pickleball, the scarcest sport, adds a few extra stock top-ups).
 * Pool sizes: badminton 15, pickleball 15, mini football 12, tennis 13,
 * basketball 15, swimming 12. Unknown sports return null and VenueImage
 * renders the gradient + sport-emoji banner. No API key, no runtime
 * API calls, no DB column.
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
 * Sport-level photo pools, keyed by sport slug. Real-facility photos
 * lead each pool (sources named per entry); the venue slug hash picks
 * one deterministically, so a given venue always shows the same photo.
 */
export const VENUE_IMAGES: Record<string, string[]> = {
  // Cầu lông — 15 photos: 11 real-facility photos first,
  // then the original verified stock entries.
  "cau-long": [
    // indoor wooden badminton court mid-match at IIT Kharagpur (India) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7a/Badminton_Court_at_IIT_Kharagpur.jpg/1280px-Badminton_Court_at_IIT_Kharagpur.jpg",
    // empty multi-court indoor badminton hall — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/78/Indoor_badminton_court.jpg/1280px-Indoor_badminton_court.jpg",
    // sports hall set up for badminton with games in progress, EuroGames 2024, Vienna — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/50/Badminton_venue_at_Eurogames_2024_in_Vienna.jpg/1280px-Badminton_venue_at_Eurogames_2024_in_Vienna.jpg",
    // outdoor podium badminton court at Kai Chuen Court, Hong Kong — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0a/Kai_Chuen_Court_Badminton_Court.jpg/1280px-Kai_Chuen_Court_Badminton_Court.jpg",
    // tournament courts inside Nimibutr Stadium, Bangkok (Thailand Masters) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/af/Inside_Nimibutr_Stadium_-_Thailand_Masters_2025_%281%29.jpg/1280px-Inside_Nimibutr_Stadium_-_Thailand_Masters_2025_%281%29.jpg",
    // green courts with players at Lehragaga Stadium (India) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a2/View_of_badminton_court_at_stadium_Lehragaga.jpg/1280px-View_of_badminton_court_at_stadium_Lehragaga.jpg",
    // school badminton tournament on a green hall court — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/34/Schools_badminton1.jpg/1280px-Schools_badminton1.jpg",
    // Mei Lam Sports Centre hall, Hong Kong, badminton nets up — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/37/Mei_Lam_Stadium_Multi_Purpose_Arena_2017.jpg/1280px-Mei_Lam_Stadium_Multi_Purpose_Arena_2017.jpg",
    // outdoor court at On Ting Estate, Hong Kong — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f5/On_Ting_Estate_Badminton_Court.jpg/1280px-On_Ting_Estate_Badminton_Court.jpg",
    // Queen Elizabeth Stadium hall, Hong Kong, badminton in play — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/16/HK_QueenElizabethStadium_MultiPurposeHall.jpg/1280px-HK_QueenElizabethStadium_MultiPurposeHall.jpg",
    // the club's own green indoor courts — Cốc Cốc Badminton, Bình Tân, HCMC (photo via top3.vn)
    "https://top3.vn/uploads/source/thevinh/cau-long/cau-long-coc-coc-binh-tan/2024-06-29-(1).webp",
    "https://images.unsplash.com/photo-1614058585449-0aceebe022cc?auto=format&fit=crop&w=1200&q=80",
    "https://images.pexels.com/photos/7438732/pexels-photo-7438732.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/8007162/pexels-photo-8007162.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/8007405/pexels-photo-8007405.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
  // Pickleball — 15 photos: 7 real-facility photos first,
  // then the original verified stock entries plus 4 stock top-ups.
  pickleball: [
    // aerial view of a full pickleball complex with games in progress — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/19/Aerial_Pickleball_Courts.jpg/1280px-Aerial_Pickleball_Courts.jpg",
    // blue/green courts at Harry B. Anderson Tennis Center, Green Bay (USA) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c6/Harry_B._Anderson_Tennis_Center_-_Pickleball_Courts_1-3.jpg/1280px-Harry_B._Anderson_Tennis_Center_-_Pickleball_Courts_1-3.jpg",
    // aerial view of eight blue courts in La Crosse, Wisconsin — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/71/Pickleball_court_in_La_Crosse%2C_Wisconsin_01.jpg/1280px-Pickleball_court_in_La_Crosse%2C_Wisconsin_01.jpg",
    // aerial view of two outdoor courts — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/39/Outdoor_pickleball_courts.jpg/1280px-Outdoor_pickleball_courts.jpg",
    // urban courts at Hunter's Point Community Park, New York — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b1/Hunter%27s_Pt_Community_Pk_td_%282023-08-21%29_04.jpg/1280px-Hunter%27s_Pt_Community_Pk_td_%282023-08-21%29_04.jpg",
    // indoor court inside the Plankinton Arcade atrium, Milwaukee — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cd/Milwaukee_November_2022_34_%28Plankinton_Arcade_pickleball_court%29.jpg/1280px-Milwaukee_November_2022_34_%28Plankinton_Arcade_pickleball_court%29.jpg",
    // doubles action at the net on an outdoor court — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Pickleball_Pros.jpg/1280px-Pickleball_Pros.jpg",
    "https://images.pexels.com/photos/29820786/pexels-photo-29820786.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/37143606/pexels-photo-37143606.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/29439337/pexels-photo-29439337.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/17299530/pexels-photo-17299530.jpeg?auto=compress&cs=tinysrgb&w=1200",
    // stock top-up: player in action at Pickleball 1990, a real indoor club in Hanoi
    "https://images.pexels.com/photos/29439346/pexels-photo-29439346.jpeg?auto=compress&cs=tinysrgb&w=1200",
    // stock top-up: sunlit empty court with long net shadows
    "https://images.pexels.com/photos/29820785/pexels-photo-29820785.jpeg?auto=compress&cs=tinysrgb&w=1200",
    // stock top-up: top-down view of blue courts and nets
    "https://images.pexels.com/photos/29821186/pexels-photo-29821186.jpeg?auto=compress&cs=tinysrgb&w=1200",
    // stock top-up: a player hitting indoors against the green hall wall
    "https://images.pexels.com/photos/32975182/pexels-photo-32975182.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
  // Bóng đá mini — 12 photos: 8 real-facility photos first,
  // then the original verified stock entries.
  "bong-da-mini": [
    // goalkeeper action at the 2018 Youth Olympics futsal final, Buenos Aires — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/20/2018-10-18_Futsal_%28Boys_Final%29_at_2018_Summer_Youth_Olympics_by_Sandro_Halank%E2%80%93050.jpg/1280px-2018-10-18_Futsal_%28Boys_Final%29_at_2018_Summer_Youth_Olympics_by_Sandro_Halank%E2%80%93050.jpg",
    // futsal arena at the 2016 AFC Championship (Japan v Vietnam), Tashkent — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9e/2016_Futsal_Japan_vs_Vietnam_a.JPG/1280px-2016_Futsal_Japan_vs_Vietnam_a.JPG",
    // outdoor turf futsal courts at Yoyogi, Tokyo — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4d/Tokyo_Yoyogi_futsal_court.JPG/1280px-Tokyo_Yoyogi_futsal_court.JPG",
    // school sports courts incl. futsal at ACS Barker Road, Singapore — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a5/ACS%28BR%29_Futsal_Court.JPG/1280px-ACS%28BR%29_Futsal_Court.JPG",
    // caged turf pitch with a game in progress (KPU, Canada) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b9/KPU_Futsal_Court.jpg/1280px-KPU_Futsal_Court.jpg",
    // covered courts at Delta Sport Centre, Singapore, seen from the gallery — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/85/Converted_pickleball_courts%2C_futsal_court_and_hockey_pitch_at_Delta_Sport_Centre.jpg/1280px-Converted_pickleball_courts%2C_futsal_court_and_hockey_pitch_at_Delta_Sport_Centre.jpg",
    // outdoor futsal courts at Complejo Deportivo Sur (Spain) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7a/Pistas_de_futsal_del_Complejo_Deportivo_Sur.jpg/1280px-Pistas_de_futsal_del_Complejo_Deportivo_Sur.jpg",
    // match action, Portugal v Japan, 2018 Youth Olympics girls' final — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/69/2018-10-17_Futsal_POR_vs_JPN_%28Girls_Final%29_at_2018_Summer_Youth_Olympics_by_Sandro_Halank%E2%80%930311.jpg/1280px-2018-10-17_Futsal_POR_vs_JPN_%28Girls_Final%29_at_2018_Summer_Youth_Olympics_by_Sandro_Halank%E2%80%930311.jpg",
    "https://images.pexels.com/photos/36681531/pexels-photo-36681531.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/28271652/pexels-photo-28271652.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/33620335/pexels-photo-33620335.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/34007009/pexels-photo-34007009.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
  // Quần vợt — 13 photos: 9 real-facility photos first,
  // then the original verified stock entries.
  "quan-vot": [
    // aerial view of blue hard courts in Ajax (Canada), players on court — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4e/Aerial_Photograph_of_Tennis_Courts_in_Ajax_-_Discover_The_Town_Of_Ajax_%2801m14s%29.jpg/1280px-Aerial_Photograph_of_Tennis_Courts_in_Ajax_-_Discover_The_Town_Of_Ajax_%2801m14s%29.jpg",
    // aerial view of clay courts in Cologne (Germany) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/74/Aerial_view_of_tennis_courts_in_Cologne%2C_Germany_%2850390585946%29.jpg/1280px-Aerial_view_of_tennis_courts_in_Cologne%2C_Germany_%2850390585946%29.jpg",
    // clay courts at Poller Wiesen, Cologne — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9d/Tennis_courts_at_Poller_Wiesen_in_Cologne%2C_Germany_%2848988353677%29.jpg/1280px-Tennis_courts_at_Poller_Wiesen_in_Cologne%2C_Germany_%2848988353677%29.jpg",
    // the court complex at IMG Academy, Bradenton (USA), from above — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bd/Tennis_Courts_IMG_Academy_-_Bradenton.jpg/1280px-Tennis_Courts_IMG_Academy_-_Bradenton.jpg",
    // clay courts of Idsteiner Tennis-Club (Germany), from above — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/69/Tennispl%C3%A4tze_Idsteiner_Tennis-Club_Gr%C3%BCn-Wei%C3%9F-0846.jpg/1280px-Tennispl%C3%A4tze_Idsteiner_Tennis-Club_Gr%C3%BCn-Wei%C3%9F-0846.jpg",
    // the All England Club, Wimbledon, from above — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/49/Uk_london_wimbeldon_courts.jpg/1280px-Uk_london_wimbeldon_courts.jpg",
    // GBK Tennis Outdoor Stadium, Jakarta — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3b/GBK_Tennis_Outdoor_Stadium.jpg/1280px-GBK_Tennis_Outdoor_Stadium.jpg",
    // lakeside clay courts of TuS Haltern am See (Germany), from above — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/14/Haltern_am_See%2C_TUS-Tennis_--_2014_--_9105.jpg/1280px-Haltern_am_See%2C_TUS-Tennis_--_2014_--_9105.jpg",
    // clay courts in Oslo (Norway), from above — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e2/Tennis_courts_in_Oslo_aerial.jpg/1280px-Tennis_courts_in_Oslo_aerial.jpg",
    "https://images.unsplash.com/photo-1465125672495-63cdc2fa22ed?auto=format&fit=crop&w=1200&q=80",
    "https://images.pexels.com/photos/35564300/pexels-photo-35564300.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/37112832/pexels-photo-37112832.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/8224639/pexels-photo-8224639.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
  // Bóng rổ — 15 photos: 11 real-facility photos first,
  // then the original verified stock entries.
  "bong-ro": [
    // outdoor court in HCMC — photo from sonsanepoxy.vn's HCMC courts guide
    "https://sonsanepoxy.vn/storage/news/san-bong-ro-tphcm.jpg",
    // blue residential court in HCMC — sonsanepoxy.vn
    "https://sonsanepoxy.vn/storage/news/san-bong-ro-tphcm-2.jpg",
    // green/red street court with a game on, HCMC — sonsanepoxy.vn
    "https://sonsanepoxy.vn/storage/news/san-bong-ro-tphcm-4.jpg",
    // streetball game on a concrete court, HCMC — sonsanepoxy.vn
    "https://sonsanepoxy.vn/storage/news/san-bong-ro-hcm-31.jpg",
    // covered court with mural wall at Donbosco Bến Cát, Gò Vấp — sonsanepoxy.vn
    "https://sonsanepoxy.vn/storage/news/san-bong-ro.jpg",
    // youth game at Nhà Thiếu Nhi Quận 12 — photo via thethaothienlong.vn
    "https://thethaothienlong.vn/wp-content/uploads/2022/04/San-bong-ro-quan-12-1.jpg",
    // youth game on a blue outdoor court, HCMC — hocbongro.com.vn
    "https://hocbongro.com.vn/wp-content/uploads/2020/01/san-bong-ro-mien-phi-o-tphcm.jpg",
    // red/green campus court, HCMC — hocbongro.com.vn
    "https://hocbongro.com.vn/wp-content/uploads/2020/01/san-bong-ro-sai-gon.jpg",
    // night court at Havukoski youth centre, Vantaa (Finland) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e2/Autumn_night_at_basketball_court_at_Havukoski_youth_centre%2C_Havukoski%2C_Vantaa%2C_Finland%2C_2021_October.jpg/1280px-Autumn_night_at_basketball_court_at_Havukoski_youth_centre%2C_Havukoski%2C_Vantaa%2C_Finland%2C_2021_October.jpg",
    // indoor arena court at Jamia Millia Islamia, New Delhi — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Basketball_Court%2C_Jamia_Millia_Islamia%2C_New_Delhi.jpg/1280px-Basketball_Court%2C_Jamia_Millia_Islamia%2C_New_Delhi.jpg",
    // seaside court at La Perla, San Juan (Puerto Rico) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1d/Basketball_court_at_La_Perla_in_San_Juan%2C_Puerto_Rico.jpg/1280px-Basketball_court_at_La_Perla_in_San_Juan%2C_Puerto_Rico.jpg",
    "https://images.unsplash.com/photo-1494199505258-5f95387f933c?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1516802273409-68526ee1bdd6?auto=format&fit=crop&w=1200&q=80",
    "https://images.pexels.com/photos/15783797/pexels-photo-15783797.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/19514919/pexels-photo-19514919.jpeg?auto=compress&cs=tinysrgb&w=1200",
  ],
  // Bơi lội — 12 photos: 8 real-facility photos first,
  // then the original verified stock entries.
  "boi-loi": [
    // outdoor lane pool at Bellbowrie, Brisbane — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/75/Bellbowrie_swimming_pool%2C_main_pool_with_lanes%2C_2025.jpg/1280px-Bellbowrie_swimming_pool%2C_main_pool_with_lanes%2C_2025.jpg",
    // competition natatorium at King County Aquatic Center (USA) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/73/King_County_Aquatic_Center_competition_natatorium_-_23_November_2022.jpg/1280px-King_County_Aquatic_Center_competition_natatorium_-_23_November_2022.jpg",
    // indoor pool at Melbourne Sports and Aquatic Centre — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/66/Melbourne_Sports_and_Aquatic_Centre.jpg/1280px-Melbourne_Sports_and_Aquatic_Centre.jpg",
    // the 50 m outdoor pool at Westbad, Munich — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/55/Large_50_m_public_swimming_pool_%27Westbad%27_in_Munich_without_people_n.2.jpg/1280px-Large_50_m_public_swimming_pool_%27Westbad%27_in_Munich_without_people_n.2.jpg",
    // starting blocks over red lane ropes at an indoor competition pool — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/91/Starting_blocks_in_an_olympic_swimming_pool_with_lanes.jpg/1280px-Starting_blocks_in_an_olympic_swimming_pool_with_lanes.jpg",
    // lanes and starting blocks at the Australian Institute of Sport, Canberra — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8c/Swimming_Pool_lanes_and_starting_blocks_at_AIS.jpg/1280px-Swimming_Pool_lanes_and_starting_blocks_at_AIS.jpg",
    // indoor lane pool at Monroe Community College (USA) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0f/Monroe_Community_College_Swimming_Pool.jpg/1280px-Monroe_Community_College_Swimming_Pool.jpg",
    // indoor pool at Runcorn Swimming Pool (UK) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/55/Access_ramp_on_indoor_pool%2C_Runcorn_Swimming_Pool%2C_Runcorn_DSCF6198.jpg/1280px-Access_ramp_on_indoor_pool%2C_Runcorn_Swimming_Pool%2C_Runcorn_DSCF6198.jpg",
    "https://images.pexels.com/photos/40068492/pexels-photo-40068492.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/19073612/pexels-photo-19073612.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/9030294/pexels-photo-9030294.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "https://images.pexels.com/photos/8028692/pexels-photo-8028692.jpeg?auto=compress&cs=tinysrgb&w=1200",
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
