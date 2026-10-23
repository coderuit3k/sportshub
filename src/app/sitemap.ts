import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const venues = await prisma.venue.findMany({ where: { status: "APPROVED" }, select: { slug: true, updatedAt: true } }).catch(() => []);
  return [
    { url: `${base}/`, lastModified: new Date() },
    { url: `${base}/venues`, lastModified: new Date() },
    { url: `${base}/community`, lastModified: new Date() },
    ...venues.map((v) => ({ url: `${base}/venues/${v.slug}`, lastModified: v.updatedAt })),
  ];
}
