import type { NextConfig } from "next";
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
    ],
  },
};
export default nextConfig;
