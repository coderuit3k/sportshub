"use client";

import { useState } from "react";
import Image from "next/image";
import { resolveVenueDisplayImage } from "@/lib/venue-images";
import { sportEmoji } from "@/components/SportIcon";

/**
 * Venue banner. Display priority (see src/lib/venue-images.ts and
 * docs/architecture.md → "Image storage"):
 *   1. the venue's stored primary photo (Cloudflare R2 — a migrated
 *      copy of the curated photo, or an owner-uploaded photo),
 *   2. the curated code-map photo (per-venue override → sport pool),
 *   3. the pre-photo fallback: a gradient banner with the sport emoji.
 *
 * A candidate that fails to load falls through to the next one, so a
 * frame never renders broken or empty. Alt text is the venue name.
 */
export default function VenueImage({
  primarySportSlug,
  venueSlug,
  venueName,
  storedImageUrl,
  className = "",
  gradientClassName = "from-primary via-secondary to-primary",
  emojiClassName = "text-4xl",
  emojiAlign = "left",
  sizes = "(max-width: 768px) 100vw, 400px",
}: {
  primarySportSlug?: string | null;
  venueSlug: string;
  venueName: string;
  /** Stored primary photo URL from the public DTOs; null/omitted → code map only. */
  storedImageUrl?: string | null;
  className?: string;
  gradientClassName?: string;
  emojiClassName?: string;
  emojiAlign?: "left" | "right";
  sizes?: string;
}) {
  const mapImage = resolveVenueDisplayImage({
    storedImageUrl: null,
    primarySportSlug,
    venueSlug,
  });
  const candidates = [
    ...new Set([storedImageUrl, mapImage].filter((u): u is string => Boolean(u))),
  ];
  const [failedCount, setFailedCount] = useState(0);
  const src = candidates[failedCount] ?? null;

  if (!src) {
    return (
      <div
        aria-hidden
        className={`absolute inset-0 flex items-end bg-gradient-to-br p-4 ${gradientClassName} ${emojiAlign === "right" ? "justify-end" : ""} ${className}`}
      >
        <span className={emojiClassName}>
          {primarySportSlug ? sportEmoji(primarySportSlug) : "🏟️"}
        </span>
      </div>
    );
  }

  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`}>
      <Image
        src={src}
        alt={venueName}
        fill
        sizes={sizes}
        className="object-cover"
        onError={() => setFailedCount((c) => c + 1)}
      />
    </div>
  );
}
