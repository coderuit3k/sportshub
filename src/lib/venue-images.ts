/**
 * Venue photos.
 *
 * Primary strategy: one photo per seed venue, sourced from a REAL
 * sports-facility website of the same sport wherever a usable wide
 * shot could be verified — see VENUE_PHOTOS below, each entry names
 * its source. Every URL was verified individually: HTTP 200 + image
 * content type with our own site sent as Referer (hotlinking must
 * work), the downloaded bytes are a real image, and a visual check
 * confirmed the photo shows that sport's actual court / hall / pool
 * in a wide shot (no equipment close-ups, portraits, text-heavy
 * banners or logos).
 *
 * Fallback: venues without a per-venue photo use the sport-level pool
 * (VENUE_IMAGES), picked deterministically by hashing the venue slug.
 * The pools are real facility photography too: photos of real courts
 * / halls / pools — Vietnamese operator and sports-guide sites where
 * usable shots could be verified, plus Wikimedia Commons photos of
 * named facilities worldwide (CC-licensed, see docs/architecture.md
 * for the credit note). A full visual audit (Oct 2026) re-checked
 * every pool entry as it renders in the 400x160 card / 800x256 hero
 * crop and replaced anything that read as aerial / drone, a
 * broadcast or crowd frame, a portrait or equipment close-up, a
 * school / multi-purpose hall, or an unfinished or derelict site;
 * every pool is now 100% real-facility photos — the last legacy
 * stock entries were purged on 2026-10-26, together with the 10
 * venues whose slug-hash picks landed on them (those venues were
 * removed outright by owner decision; see REMOVED_VENUE_SLUGS in
 * prisma/venue-catalog.ts). Pool sizes: badminton 12, pickleball 11,
 * mini football 10, tennis 13, basketball 12, swimming 11. Unknown
 * sports return null and VenueImage renders the gradient +
 * sport-emoji banner.
 * No API key, no runtime API calls.
 *
 * DISPLAY PRIORITY (see docs/architecture.md → "Image storage"): the
 * map in this file is only the DEFAULT assignment. What a venue
 * actually shows is resolved by resolveVenueDisplayImage():
 *   1. the venue's stored primary photo (VenueImage row in the DB —
 *      an R2 copy of the map photo written by the deploy-time
 *      migration in prisma/photo-migration.ts, or a photo the venue
 *      owner uploaded), then
 *   2. this file's map (per-venue override → sport pool), then
 *   3. null → VenueImage renders the gradient + emoji banner.
 */
const VENUE_PHOTOS: Record<string, string> = {
  // Smash Arena Thủ Đức (badminton, indoor) — Quốc Việt Badminton
  // (qvbadminton.com): wide shot of their own indoor badminton hall in
  // HCMC, green courts in play.
  "smash-arena-thu-duc":
    "https://qvbadminton.com/wp-content/uploads/2024/12/khong-gian-san-cau-long-quoc-viet-badminton-quan-7.jpg",
  // PickleHub Bình Thạnh (pickleball) — the Guangzhou Metro
  // Pickleball Center at Pazhou Station (Wikimedia Commons): a vast
  // indoor hall of pink / purple courts. The venue's namesake club
  // site (pickleballtrungdoangiadinh.com) was re-checked in the Oct
  // 2026 audit: its only court-level photo is a tight two-player shot
  // at the net and everything else is a group / podium photo, a
  // marketing banner or a CCTV still, so the override moved to this
  // verified wide shot of a real pickleball centre.
  "pickle-hub-binh-thanh":
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b3/Guangzhou_Metro_Pickleball_Center%2C_Pazhou_Station%2C_Guangzhou_Metro_20251002.jpg/1280px-Guangzhou_Metro_Pickleball_Center%2C_Pazhou_Station%2C_Guangzhou_Metro_20251002.jpg",
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
  // Shaheed Tajuddin Ahmad Indoor Stadium, Dhaka (Wikimedia Commons):
  // green badminton courts below the seating gallery. Quốc Việt
  // Badminton's second hall photo was dropped in the Oct 2026 audit —
  // a giant brand banner fills the centre of the frame.
  "new-court-pending-binh-thanh":
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8d/Seating_gallery_in_Shaheed_Tajuddin_Ahmad_Indoor_Stadium.jpg/1280px-Seating_gallery_in_Shaheed_Tajuddin_Ahmad_Indoor_Stadium.jpg",
  // No per-venue photo for sai-gon-mini-football-q7 or
  // riverside-tennis-q1: no usable wide shot of a real facility could
  // be verified on a Vietnamese operator's own website (the candidate
  // sites served only stock close-ups, player portraits or text-heavy
  // marketing banners), so both fall through to the sport-level pools
  // below — see docs/architecture.md, "Venue photos".
};
/**
 * Sport-level photo pools, keyed by sport slug. Real-facility photos
 * throughout (sources named per entry); the venue slug hash picks
 * one deterministically, so a given venue always shows the same photo.
 */
export const VENUE_IMAGES: Record<string, string[]> = {
  // Cầu lông — 12 photos, all real facilities.
  "cau-long": [
    // indoor wooden badminton court mid-match at IIT Kharagpur (India) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7a/Badminton_Court_at_IIT_Kharagpur.jpg/1280px-Badminton_Court_at_IIT_Kharagpur.jpg",
    // empty multi-court indoor badminton hall — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/78/Indoor_badminton_court.jpg/1280px-Indoor_badminton_court.jpg",
    // green courts with players at Lehragaga Stadium (India) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a2/View_of_badminton_court_at_stadium_Lehragaga.jpg/1280px-View_of_badminton_court_at_stadium_Lehragaga.jpg",
    // Mei Lam Sports Centre hall, Hong Kong, badminton nets up — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/37/Mei_Lam_Stadium_Multi_Purpose_Arena_2017.jpg/1280px-Mei_Lam_Stadium_Multi_Purpose_Arena_2017.jpg",
    // Queen Elizabeth Stadium hall, Hong Kong, badminton in play — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/16/HK_QueenElizabethStadium_MultiPurposeHall.jpg/1280px-HK_QueenElizabethStadium_MultiPurposeHall.jpg",
    // the club's own green indoor courts — Cốc Cốc Badminton, Bình Tân, HCMC (photo via top3.vn)
    "https://top3.vn/uploads/source/thevinh/cau-long/cau-long-coc-coc-binh-tan/2024-06-29-(1).webp",
    // teal mats in the wood-panelled hall at IIT Delhi (India) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6a/Badminton_Court_at_IITD.jpg/1280px-Badminton_Court_at_IITD.jpg",
    // rooftop courts with nets up at Tin Fu Court, Hong Kong — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e3/Tin_Fu_Court_Badminton_Court.jpg/1280px-Tin_Fu_Court_Badminton_Court.jpg",
    // outdoor courts with nets between the towers of Hung Fuk Estate, Hong Kong — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b6/Hung_Fuk_Estate_Badminton_Court_201512.jpg/1280px-Hung_Fuk_Estate_Badminton_Court_201512.jpg",
    // blue outdoor court with net at Tin Shing Court, Hong Kong — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fe/Tin_Shing_Court_Badminton_Court.jpg/1280px-Tin_Shing_Court_Badminton_Court.jpg",
    // blue outdoor court at Kam Tai Court, Hong Kong — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/22/Kam_Tai_Court_Badminton_Court_201712.jpg/1280px-Kam_Tai_Court_Badminton_Court_201712.jpg",
    // club tournament on green mats in a wooden hall (France) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/58/Tournoi_badminton_280913_12.JPG/1280px-Tournoi_badminton_280913_12.JPG",
  ],
  // Pickleball — 11 photos, all real facilities.
  pickleball: [
    // blue/green courts at Harry B. Anderson Tennis Center, Green Bay (USA) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c6/Harry_B._Anderson_Tennis_Center_-_Pickleball_Courts_1-3.jpg/1280px-Harry_B._Anderson_Tennis_Center_-_Pickleball_Courts_1-3.jpg",
    // urban courts at Hunter's Point Community Park, New York — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b1/Hunter%27s_Pt_Community_Pk_td_%282023-08-21%29_04.jpg/1280px-Hunter%27s_Pt_Community_Pk_td_%282023-08-21%29_04.jpg",
    // doubles action at the net on an outdoor court — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Pickleball_Pros.jpg/1280px-Pickleball_Pros.jpg",
    // outdoor courts at dusk, Poliforum, Playa del Carmen (Mexico) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e8/20251212_pickleball_pitch_poliforum_playa_del_carmen.jpg/1280px-20251212_pickleball_pitch_poliforum_playa_del_carmen.jpg",
    // indoor courts inside the Bell Works building (USA) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/40/Bell_Works_Interior_Pickleball_Court_%28December_2025%29.jpg/1280px-Bell_Works_Interior_Pickleball_Court_%28December_2025%29.jpg",
    // courts 10-12 at Harry B. Anderson Tennis Center, Green Bay — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/25/Harry_B._Anderson_Tennis_Center_-_Pickleball_Courts_10-12.jpg/1280px-Harry_B._Anderson_Tennis_Center_-_Pickleball_Courts_10-12.jpg",
    // courts 4-6 at Harry B. Anderson Tennis Center, Green Bay — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/02/Harry_B._Anderson_Tennis_Center_-_Pickleball_Courts_4-6.jpg/1280px-Harry_B._Anderson_Tennis_Center_-_Pickleball_Courts_4-6.jpg",
    // courts 7-9 at Harry B. Anderson Tennis Center, Green Bay — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/32/Harry_B._Anderson_Tennis_Center_-_Pickleball_Courts_7-9.jpg/1280px-Harry_B._Anderson_Tennis_Center_-_Pickleball_Courts_7-9.jpg",
    // a second bank of urban courts at Hunter's Point Community Park, New York — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a0/Hunter%27s_Pt_Community_Pk_td_%282023-08-21%29_05.jpg/1280px-Hunter%27s_Pt_Community_Pk_td_%282023-08-21%29_05.jpg",
    // games under the timber roof of Parc du Pré-Vert (France) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/25/Parc_du_Pr%C3%A9-Vert%2C_terrains_de_pickleball.jpg/1280px-Parc_du_Pr%C3%A9-Vert%2C_terrains_de_pickleball.jpg",
    // purple / blue courts at Polideportivo Municipal Gallur, Madrid — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bf/Pistas_de_pickleball_en_Madrid_Espa%C3%B1a%2C_Polideportivo_Municipal_Gallur.jpg/1280px-Pistas_de_pickleball_en_Madrid_Espa%C3%B1a%2C_Polideportivo_Municipal_Gallur.jpg",
  ],
  // Bóng đá mini — 10 photos, all real facilities.
  "bong-da-mini": [
    // outdoor turf futsal courts at Yoyogi, Tokyo — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4d/Tokyo_Yoyogi_futsal_court.JPG/1280px-Tokyo_Yoyogi_futsal_court.JPG",
    // caged turf pitch with a game in progress (KPU, Canada) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b9/KPU_Futsal_Court.jpg/1280px-KPU_Futsal_Court.jpg",
    // outdoor futsal courts at Complejo Deportivo Sur (Spain) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7a/Pistas_de_futsal_del_Complejo_Deportivo_Sur.jpg/1280px-Pistas_de_futsal_del_Complejo_Deportivo_Sur.jpg",
    // indoor dome turf pitch at Aoba Sports Park (Japan) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5d/Aoba_Sports_park_-_soccer_court.jpg/1280px-Aoba_Sports_park_-_soccer_court.jpg",
    // empty outdoor turf pitch with a goal — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/93/Futsal_Court.jpg/1280px-Futsal_Court.jpg",
    // blue court inside Teva Ocean Arena (Japan), from the gallery — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2b/Teva_Ocean_Arena_futsal.JPG/1280px-Teva_Ocean_Arena_futsal.JPG",
    // evening game on a caged turf pitch at Klet Kaeo (Thailand) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8b/DFC_5329_Evening_kickabout_in_Klet_Kaeo_-_teammates_line_up_as_a_player_strikes_the_ball_on_the_artificial_turf.jpg/1280px-DFC_5329_Evening_kickabout_in_Klet_Kaeo_-_teammates_line_up_as_a_player_strikes_the_ball_on_the_artificial_turf.jpg",
    // wide turf field at Stanton Street Courts, New York — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f5/Stanton_Street_Courts_td_%282018-12-31%29_22_-_Nike_Field.jpg/1280px-Stanton_Street_Courts_td_%282018-12-31%29_22_-_Nike_Field.jpg",
    // floodlit striped turf pitch at night with a game on (Vietnam) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/53/Bong_da_mini.jpg/1280px-Bong_da_mini.jpg",
    // caged community pitch at Calthorpe Community Garden, London — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/89/Futsal_pitch%2C_Calthorpe_Community_Garden_-_geograph.org.uk_-_4534718.jpg/1280px-Futsal_pitch%2C_Calthorpe_Community_Garden_-_geograph.org.uk_-_4534718.jpg",
  ],
  // Quần vợt — 13 photos, all real facilities (Wikimedia Commons).
  "quan-vot": [
    // blue hard courts in Németvölgy, Budapest — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a1/14._Hegyvid%C3%A9k-Olympiade%2C_Tennisplatz%2C_2024_N%C3%A9metv%C3%B6lgy.jpg/1280px-14._Hegyvid%C3%A9k-Olympiade%2C_Tennisplatz%2C_2024_N%C3%A9metv%C3%B6lgy.jpg",
    // a second court at the same Németvölgy club, Budapest — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e8/14._Hegyvid%C3%A9k-Olympiade%2C_Tennisplatz%2C_O%2C_2024_N%C3%A9metv%C3%B6lgy.jpg/1280px-14._Hegyvid%C3%A9k-Olympiade%2C_Tennisplatz%2C_O%2C_2024_N%C3%A9metv%C3%B6lgy.jpg",
    // clay court at Oakmont Tennis Club, Allentown (USA) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/79/2019_-_Oakmont_Tennis_Club_-_Court_-_Allentown_PA.jpg/1280px-2019_-_Oakmont_Tennis_Club_-_Court_-_Allentown_PA.jpg",
    // floodlit clay-court complex (AEC outdoor courts) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8e/AEC_Outdoor_Tennis_Courts.png/1280px-AEC_Outdoor_Tennis_Courts.png",
    // grass courts in play at Nottingham Tennis Centre (geograph) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1b/Outdoor_courts%2C_Nottingham_Tennis_Centre_-_geograph.org.uk_-_7416683.jpg/1280px-Outdoor_courts%2C_Nottingham_Tennis_Centre_-_geograph.org.uk_-_7416683.jpg",
    // green hard courts at David Lloyd Tennis Club, York (geograph) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e5/Tennis_Court_at_David_Lloyd_Tennis_Club_York_-_geograph.org.uk_-_5872789.jpg/1280px-Tennis_Court_at_David_Lloyd_Tennis_Club_York_-_geograph.org.uk_-_5872789.jpg",
    // hard courts at Plaxtol & Shipbourne Tennis Club, Kent — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e7/Tennis_courts%2C_Plaxtol_%26_Shipbourne_Tennis_Club%2C_Shipbourne%2C_Kent_-_June_2026_-_01.jpg/1280px-Tennis_courts%2C_Plaxtol_%26_Shipbourne_Tennis_Club%2C_Shipbourne%2C_Kent_-_June_2026_-_01.jpg",
    // red / green hard courts at Framlingham Sports Club (geograph) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/25/Framlingham_Sports_Club_Tennis_Courts_-_geograph.org.uk_-_2435764.jpg/1280px-Framlingham_Sports_Club_Tennis_Courts_-_geograph.org.uk_-_2435764.jpg",
    // grass courts at The Northern Tennis Club, West Didsbury — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f6/The_Northern_Tennis_Club_in_West_Didsbury.jpg/1280px-The_Northern_Tennis_Club_in_West_Didsbury.jpg",
    // clay courts at Braddon Tennis Club, Canberra — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/27/Braddon_Tennis_Club_October_2025.jpg/1280px-Braddon_Tennis_Club_October_2025.jpg",
    // clay court seen down the net, Melbourne — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/85/Clay_tennis_courts_melbourne_looking_down_the_net.jpg/1280px-Clay_tennis_courts_melbourne_looking_down_the_net.jpg",
    // hard courts in the woods at Normandy Tennis Club, Surrey — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/86/Courts_1_and_2%2C_Normandy_Tennis_Club%2C_Hunts_Hill_Road%2C_Normandy%2C_Surrey.jpg/1280px-Courts_1_and_2%2C_Normandy_Tennis_Club%2C_Hunts_Hill_Road%2C_Normandy%2C_Surrey.jpg",
    // club clay courts with a game on (geograph) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7b/Tennis_courts_%28geograph_7558513%29.jpg/1280px-Tennis_courts_%28geograph_7558513%29.jpg",
  ],
  // Bóng rổ — 12 photos, all real facilities.
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
    // wide empty courts at Astoria Heights Playground, New York — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/71/Astoria_Heights_Playground_td_%282022-10-03%29_03_-_Basketball_Courts.jpg/1280px-Astoria_Heights_Playground_td_%282022-10-03%29_03_-_Basketball_Courts.jpg",
    // blue / green park courts at Campbell Park (Australia) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/09/Basketball_courts_at_Campbell_Park.jpg/1280px-Basketball_courts_at_Campbell_Park.jpg",
    // indoor courts in the Lanman Center at Yale University — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a2/Basketball_courts_in_the_Lanman_Center_at_Payne_Whitney_Gymnasium_at_Yale_University%2C_2018.jpg/1280px-Basketball_courts_in_the_Lanman_Center_at_Payne_Whitney_Gymnasium_at_Yale_University%2C_2018.jpg",
    // game on the red / grey Zone Six court, Đống Đa, Hanoi — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/75/Basketball_game%2C_%C4%90%E1%BB%91ng_%C4%90a%2C_Hanoi%2C_May_2023.jpg/1280px-Basketball_game%2C_%C4%90%E1%BB%91ng_%C4%90a%2C_Hanoi%2C_May_2023.jpg",
  ],
  // Bơi lội — 11 photos, all real facilities.
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
    // classic indoor pool hall with a diving platform — Wikimedia Commons (Flickr)
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d0/Indoor_Pool_%2814859634373%29.jpg/1280px-Indoor_Pool_%2814859634373%29.jpg",
    // race in progress at a public competition pool, Melbourne — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f9/Public_Swimming_Pool_in_Melbourne_VIC_Australia.jpg/1280px-Public_Swimming_Pool_in_Melbourne_VIC_Australia.jpg",
    // green-lit indoor lane pool at Ulju Youth Center (Korea) — Wikimedia Commons
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/69/Ulju_youth_center_swimming_pool_20170312_153937.jpg/1280px-Ulju_youth_center_swimming_pool_20170312_153937.jpg",
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
 * mapped, otherwise a deterministic pick from the primary sport's pool
 * (stable hash of the venue slug, so a given venue's photo never
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

/**
 * Photo for a facility (sub-court) card on the venue detail page. The
 * venue hero already shows the venue's own pick from the sport pool
 * (or its per-venue override), so facility cards rotate FORWARD from
 * the venue's pool index: facility i shows
 * pool[(venueIndex + 1 + i) % len]. Sibling cards therefore show
 * different photos and the first card never repeats the hero pick —
 * unless the pool holds a single photo. Returns null when the sport
 * has no pool (the card then renders the gradient + emoji fallback).
 */
export function facilityImage(
  primarySportSlug: string | null | undefined,
  venueSlug: string,
  facilityIndex: number,
): string | null {
  if (!primarySportSlug) return null;
  const urls = VENUE_IMAGES[primarySportSlug];
  if (!urls || urls.length === 0) return null;
  const venueIndex = stableHash(venueSlug) % urls.length;
  const offset = (((1 + facilityIndex) % urls.length) + urls.length) % urls.length;
  return urls[(venueIndex + offset) % urls.length];
}

/**
 * The venue's stored primary photo URL, or null. `images` must be the
 * venue's VenueImage rows ordered by sortOrder ascending (the primary
 * row first) — the first row whose url is an http(s) URL wins. Rows
 * holding a `gradient:*` placeholder token are NOT photos and are
 * skipped, as is any non-URL value.
 */
export function storedPrimaryImageUrl(
  images: readonly { url: string }[],
): string | null {
  for (const image of images) {
    if (/^https?:\/\//i.test(image.url)) return image.url;
  }
  return null;
}

/**
 * Resolve the photo a venue actually displays, in priority order:
 * the stored primary photo (R2 copy of the map photo, or an
 * owner-uploaded photo) beats the code map in this file; when neither
 * yields a photo, returns null and the caller renders the gradient +
 * sport-emoji fallback.
 */
export function resolveVenueDisplayImage(input: {
  storedImageUrl?: string | null;
  primarySportSlug?: string | null;
  venueSlug: string;
}): string | null {
  if (input.storedImageUrl) return input.storedImageUrl;
  return venueImage(input.primarySportSlug, input.venueSlug);
}
