"use client";

import { useState } from "react";
import Image from "next/image";
import { venueImage } from "@/lib/venue-images";
import { sportEmoji } from "@/components/SportIcon";

/**
 * Venue banner: the curated sport photo for the venue (see
 * src/lib/venue-images.ts), rendered with next/image (fill, object-cover).
 *
 * Fallback — the pre-photo look, a gradient banner with the sport emoji —
 * is used whenever the venue's sport has no verified photo, the venue has
 * no sport, or the image fails to load, so a frame never renders broken
 * or empty. Alt text is the venue name.
 */
export default function VenueImage({
  primarySportSlug,
  venueSlug,
  venueName,
  className = "",
  gradientClassName = "from-primary via-secondary to-primary",
  emojiClassName = "text-4xl",
  emojiAlign = "left",
  sizes = "(max-width: 768px) 100vw, 400px",
}: {
  primarySportSlug?: string | null;
  venueSlug: string;
  venueName: string;
  className?: string;
  gradientClassName?: string;
  emojiClassName?: string;
  emojiAlign?: "left" | "right";
  sizes?: string;
}) {
  const src = venueImage(primarySportSlug, venueSlug);
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
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
        onError={() => setFailed(true)}
      />
    </div>
  );
}
