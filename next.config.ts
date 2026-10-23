import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  images: {
    // Curated venue photos are served from the Unsplash and Pexels CDNs
    // (see src/lib/venue-images.ts).
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "images.pexels.com" },
    ],
  },
};
export default nextConfig;
