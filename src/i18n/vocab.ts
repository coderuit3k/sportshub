/**
 * Closed vocabularies that live in the DB as Vietnamese display strings
 * but have dictionary entries: sport names (keyed by slug) and amenity
 * names (keyed by their stored name). Anything outside the known sets
 * renders as stored — venue proper names and user content are never
 * translated. See messages/*.json namespaces `sports` and `amenities`.
 */

export const SPORT_SLUGS = [
  "cau-long",
  "pickleball",
  "bong-da-mini",
  "quan-vot",
  "bong-ro",
  "boi-loi",
] as const;

type Translate = (key: string) => string;

/** Translated sport name for a known slug, else the stored name. */
export function sportName(t: Translate, slug: string | null | undefined, fallback: string): string {
  return slug && (SPORT_SLUGS as readonly string[]).includes(slug) ? t(slug) : fallback;
}

const AMENITY_KEYS: Record<string, string> = {
  Wifi: "wifi",
  "Bãi xe": "parking",
  "Phòng thay đồ": "changingRoom",
  "Cho thuê vợt/bóng": "equipmentRental",
  "Nước uống": "drinks",
};

/** Translated amenity label for a known stored name, else the name itself. */
export function amenityName(t: Translate, name: string): string {
  const key = AMENITY_KEYS[name];
  return key ? t(key) : name;
}
