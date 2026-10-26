import { describe, expect, it } from "vitest";
import { VENUE_IMAGES, venueImage } from "../src/lib/venue-images";

/**
 * Guards for the sport-level venue photo pools (src/lib/venue-images.ts).
 *
 * The pools were expanded from 4 stock photos per sport to 12–15 photos
 * that lead with real-facility photography (Vietnamese operator / guide
 * sites and Wikimedia Commons photos of named facilities), so the 30
 * venues of a sport stop repeating the same handful of images. Every URL
 * was download-verified (HTTP 200 + image content type with the site as
 * Referer) and visually checked before being added.
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

  it("has at least 12 photos per sport", () => {
    for (const sport of SPORTS) {
      expect(VENUE_IMAGES[sport].length, sport).toBeGreaterThanOrEqual(12);
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

  it("is mostly real-facility photography (not stock hosts)", () => {
    const stockHosts = new Set(["images.unsplash.com", "images.pexels.com"]);
    for (const sport of SPORTS) {
      const realCount = VENUE_IMAGES[sport].filter(
        (url) => !stockHosts.has(new URL(url).hostname),
      ).length;
      // Every pool carries at least 7 real-facility photos, and they are
      // the majority everywhere except pickleball (7 of 15 — the
      // scarcest sport for real-court photography, topped up with stock).
      expect(realCount, sport).toBeGreaterThanOrEqual(7);
      if (sport !== "pickleball") {
        expect(realCount, sport).toBeGreaterThan(
          VENUE_IMAGES[sport].length / 2,
        );
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
    expect(venueImage("pickleball", "pickle-hub-binh-thanh")).toContain(
      "pickleballtrungdoangiadinh.com",
    );
  });
});
