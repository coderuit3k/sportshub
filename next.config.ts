import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Cookie-based i18n (no locale routing) — see src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Stored venue photos are served from the Cloudflare R2 bucket's
// public base URL (R2_PUBLIC_BASE_URL — set in the project env, see
// docs/architecture.md → "Image storage"). Derive its host at config
// time so next/image can optimize stored photos; before the bucket
// is connected, fall back to the generic r2.dev pattern (the
// code-map photos below are unaffected either way).
function r2PublicPattern(): { protocol: "https"; hostname: string } {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (base) {
    try {
      return { protocol: "https", hostname: new URL(base).hostname };
    } catch {
      // Misconfigured env value — fall through to the generic pattern.
    }
  }
  return { protocol: "https", hostname: "*.r2.dev" };
}

const nextConfig: NextConfig = {
  images: {
    // Venue photos: the venue's stored primary photo lives in
    // Cloudflare R2 (curated photos migrated at deploy time + owner
    // uploads — see docs/architecture.md, "Image storage"); the
    // per-venue photos and sport pools in src/lib/venue-images.ts
    // hotlink real facility websites as the fallback — every host
    // actually used is allowlisted here.
    remotePatterns: [
      r2PublicPattern(),
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "images.pexels.com" },
      // Quốc Việt Badminton (badminton halls) — qvbadminton.com
      { protocol: "https", hostname: "qvbadminton.com" },
      // Pickleball Trung Đoàn Gia Định — the club's site is HTTP-only.
      { protocol: "http", hostname: "pickleballtrungdoangiadinh.com" },
      // 29 Ballers court photos, served from their Supabase storage.
      { protocol: "https", hostname: "mdfajydtdhiuflrkruft.supabase.co" },
      // Tôn Đức Thắng University (Quận 7 pool) — tdtu.edu.vn
      { protocol: "https", hostname: "international.tdtu.edu.vn" },
      // Sport-pool real-facility photos: Wikimedia Commons thumbnails
      // (named facilities worldwide, CC-licensed — see
      // docs/architecture.md, "Venue photos").
      { protocol: "https", hostname: "thumb.wikimedia.org" },
      // Cốc Cốc Badminton (Bình Tân) photo via top3.vn's courts guide.
      { protocol: "https", hostname: "top3.vn" },
      // HCMC basketball-court photos via local sports guides.
      { protocol: "https", hostname: "sonsanepoxy.vn" },
      { protocol: "https", hostname: "thethaothienlong.vn" },
      { protocol: "https", hostname: "hocbongro.com.vn" },
    ],
  },
};
export default withNextIntl(nextConfig);
