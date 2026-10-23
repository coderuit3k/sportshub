/**
 * Per-sport emoji.
 *
 * Lucide has no badminton / pickleball / tennis pictograms, so sport visuals
 * use emoji: each glyph depicts its exact sport and stays recognizable at
 * card size. Keyed by sport slug (stable identifier) so it works for venues
 * seeded before these mappings existed — no DB re-seed required.
 */
const SPORT_EMOJI: Record<string, string> = {
  "cau-long": "🏸", // Cầu lông — badminton
  pickleball: "🏓", // Pickleball — paddle/racket sport, closest exact glyph
  "bong-da-mini": "⚽", // Bóng đá mini — football
  "quan-vot": "🎾", // Quần vợt — tennis
  "bong-ro": "🏀", // Bóng rổ — basketball
  "boi-loi": "🏊", // Bơi lội — swimming
};

/** Emoji for a sport slug; 🏅 fallback for unknown slugs. */
export function sportEmoji(slug?: string | null): string {
  return (slug ? SPORT_EMOJI[slug] : undefined) ?? "🏅";
}

export default function SportIcon({ slug, className }: { slug?: string | null; className?: string }) {
  return (
    <span className={className} aria-hidden>
      {sportEmoji(slug)}
    </span>
  );
}
