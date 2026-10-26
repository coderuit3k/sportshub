import { describe, expect, it } from "vitest";
import { VENUE_IMAGES, venueImage } from "../src/lib/venue-images";

/**
 * Guards for the sport-level venue photo pools (src/lib/venue-images.ts).
 *
 * The pools hold 10–13 photos per sport, ALL of them real-facility
 * photography (Vietnamese operator / guide sites and Wikimedia Commons
 * photos of named facilities), so the venues of a sport stop
 * repeating the same handful of images. Every URL was
 * download-verified (HTTP 200 + image content type with the site as
 * Referer) and visually checked as it renders in the card / hero crop
 * before being added — an Oct 2026 audit replaced every entry that
 * read as aerial, broadcast, portrait, close-up, school-hall,
 * unfinished or derelict, and on 2026-10-26 the last legacy stock
 * entries were purged (with the 10 venues whose slug-hash picks
 * landed on them — see REMOVED_VENUE_SLUGS in prisma/venue-catalog.ts).
 */
const SPORTS = [
  "cau-long",
  "pickleball",
  "bong-da-mini",
  "quan-vot",
  "bong-ro",
  "boi-loi",
] as const;

/** Hosts allowlisted for next/image in next.config.ts. */
const ALLOWED_HOSTS = new Set([
  "images.unsplash.com",
  "images.pexels.com",
  "thumb.wikimedia.org",
  "top3.vn",
  "sonsanepoxy.vn",
  "thethaothienlong.vn",
  "hocbongro.com.vn",
]);

describe("VENUE_IMAGES pools", () => {
  it("covers exactly the six sports", () => {
    expect(Object.keys(VENUE_IMAGES).sort()).toEqual([...SPORTS].sort());
  });

  it("has at least 10 photos per sport", () => {
    // Floor was 12 until 2026-10-26, when the owner purged the last
    // legacy stock entries (pickleball −1, mini football −2,
    // swimming −1) rather than keep any stock photo at all.
    for (const sport of SPORTS) {
      expect(VENUE_IMAGES[sport].length, sport).toBeGreaterThanOrEqual(10);
    }
  });

  it("has unique URLs within each pool and across pools", () => {
    const seen = new Set<string>();
    for (const sport of SPORTS) {
      const urls = VENUE_IMAGES[sport];
      expect(new Set(urls).size, sport).toBe(urls.length);
      for (const url of urls) {
        expect(seen.has(url), url).toBe(false);
        seen.add(url);
      }
    }
  });

  it("uses only https CDN links on allowlisted hosts", () => {
    for (const sport of SPORTS) {
      for (const url of VENUE_IMAGES[sport]) {
        const parsed = new URL(url);
        expect(parsed.protocol, url).toBe("https:");
        expect(ALLOWED_HOSTS.has(parsed.hostname), url).toBe(true);
      }
    }
  });

  it("contains ZERO stock-host photos — every pool entry is a real-facility photo", () => {
    // Since the 2026-10-26 purge no pool may link an Unsplash/Pexels
    // (stock) URL at all; every photo must come from a real facility's
    // own site or a Commons photo of a named facility.
    const stockHosts = new Set(["images.unsplash.com", "images.pexels.com"]);
    for (const sport of SPORTS) {
      for (const url of VENUE_IMAGES[sport]) {
        expect(stockHosts.has(new URL(url).hostname), `${sport}: ${url}`).toBe(false);
      }
    }
  });
});

describe("venueImage", () => {
  it("is deterministic for a given venue slug", () => {
    for (const sport of SPORTS) {
      const first = venueImage(sport, "some-venue-slug");
      expect(first).not.toBeNull();
      expect(venueImage(sport, "some-venue-slug")).toBe(first);
      expect(VENUE_IMAGES[sport]).toContain(first);
    }
  });

  it("returns null for unknown sports and missing sport", () => {
    expect(venueImage("bong-ban", "some-venue")).toBeNull();
    expect(venueImage(null, "some-venue")).toBeNull();
    expect(venueImage(undefined, "some-venue")).toBeNull();
  });

  it("keeps the per-venue real-facility overrides working", () => {
    expect(venueImage("cau-long", "smash-arena-thu-duc")).toContain(
      "qvbadminton.com",
    );
    // PickleHub's override is a verified wide shot of the Guangzhou
    // Metro Pickleball Center (Wikimedia Commons) — the namesake
    // club's own site had no usable wide court photo (see
    // src/lib/venue-images.ts).
    expect(venueImage("pickleball", "pickle-hub-binh-thanh")).toContain(
      "Guangzhou_Metro_Pickleball_Center",
    );
  });
});
