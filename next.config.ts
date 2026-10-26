import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Cookie-based i18n (no locale routing) — see src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  images: {
    // Venue photos: per-venue photos hotlinked from real facility
    // websites plus the Unsplash/Pexels stock fallback — every host
    // actually used in src/lib/venue-images.ts is allowlisted here.
    remotePatterns: [
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
