import { describe, expect, it, vi } from "vitest";
import {
  migrateVenuePhotosToStorage,
  type PhotoMigrationDeps,
} from "../prisma/photo-migration";
import { venueImage } from "../src/lib/venue-images";

/**
 * Deploy-time R2 photo migration (prisma/photo-migration.ts) with
 * the S3 put and fetch mocked via the deps seam, and an in-memory
 * Prisma stand-in. Covered semantics: not-configured skip,
 * deterministic object key + Referer download, the stored public URL
 * (<R2_PUBLIC_BASE_URL>/<key>), idempotency (rows already under the
 * public base are skipped on the second run), and per-venue failure
 * isolation — a failed download/upload leaves the row untouched and
 * is only counted, never thrown.
 */

interface FakeImage {
  id: string;
  venueId: string;
  url: string;
  caption: string | null;
  sortOrder: number;
}
interface FakeVenue {
  id: string;
  slug: string;
  name: string;
  sports: { sport: { slug: string } }[];
  images: FakeImage[];
}

const R2_BASE = "https://pub-abc123.r2.dev";

function makeFakePrisma(venues: FakeVenue[]) {
  let created = 0;
  const prisma = {
    venue: {
      findMany: vi.fn(async () => venues),
    },
    venueImage: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { url: string } }) => {
        for (const v of venues) {
          const img = v.images.find((i) => i.id === where.id);
          if (img) img.url = data.url;
        }
        return {};
      }),
      create: vi.fn(
        async ({ data }: { data: { venueId: string; url: string; caption: string; sortOrder: number } }) => {
          const venue = venues.find((v) => v.id === data.venueId);
          const img: FakeImage = { id: `created-${++created}`, ...data };
          venue?.images.push(img);
          venue?.images.sort((a, b) => a.sortOrder - b.sortOrder);
          return img;
        },
      ),
    },
  };
  return prisma;
}

function gradientRow(venueId: string): FakeImage {
  return { id: `img-${venueId}`, venueId, url: "gradient:green", caption: null, sortOrder: 0 };
}

function makeDeps(overrides: Partial<PhotoMigrationDeps> = {}): PhotoMigrationDeps {
  return {
    configured: true,
    publicBaseUrl: R2_BASE,
    referer: "https://sportshub-pi-five.vercel.app",
    fetchFn: vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === "content-type" ? "image/webp" : null) },
      arrayBuffer: async () => new ArrayBuffer(8),
    })) as unknown as typeof fetch,
    putFn: vi.fn(async (key: string) => ({ url: `${R2_BASE}/${key}` })),
    log: vi.fn(),
    errorLog: vi.fn(),
    ...overrides,
  };
}

const smashArena = (): FakeVenue => ({
  id: "v-smash",
  slug: "smash-arena-thu-duc",
  name: "Smash Arena",
  sports: [{ sport: { slug: "cau-long" } }],
  images: [gradientRow("v-smash")],
});

describe("migrateVenuePhotosToStorage", () => {
  it("skips cleanly when R2 is not configured — no fetch, no put, no writes", async () => {
    const venues = [smashArena()];
    const prisma = makeFakePrisma(venues);
    const deps = makeDeps({ configured: false, publicBaseUrl: null });
    const summary = await migrateVenuePhotosToStorage(prisma as never, deps);
    expect(summary).toEqual({ configured: false, migrated: 0, skipped: 0, failed: [] });
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(deps.putFn).not.toHaveBeenCalled();
    expect(prisma.venue.findMany).not.toHaveBeenCalled();
    expect(venues[0].images[0].url).toBe("gradient:green");
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("R2 storage not configured"));
  });

  it("migrates a placeholder row: downloads with our Referer, puts to the deterministic key, stores the public URL", async () => {
    const venues = [smashArena()];
    const prisma = makeFakePrisma(venues);
    const deps = makeDeps();
    const summary = await migrateVenuePhotosToStorage(prisma as never, deps);
    expect(summary.migrated).toBe(1);
    expect(summary.failed).toEqual([]);
    const assigned = venueImage("cau-long", "smash-arena-thu-duc");
    expect(deps.fetchFn).toHaveBeenCalledWith(assigned, {
      headers: { Referer: "https://sportshub-pi-five.vercel.app" },
    });
    expect(deps.putFn).toHaveBeenCalledWith(
      "venue-photos/smash-arena-thu-duc.jpg",
      expect.any(Buffer),
      "image/webp",
    );
    expect(venues[0].images[0].url).toBe(`${R2_BASE}/venue-photos/smash-arena-thu-duc.jpg`);
    expect(prisma.venueImage.update).toHaveBeenCalledTimes(1);
  });

  it("creates the primary row when the venue has no VenueImage row at all", async () => {
    const venue = smashArena();
    venue.images = [];
    const prisma = makeFakePrisma([venue]);
    const summary = await migrateVenuePhotosToStorage(prisma as never, makeDeps());
    expect(summary.migrated).toBe(1);
    expect(prisma.venueImage.create).toHaveBeenCalledWith({
      data: {
        venueId: "v-smash",
        url: `${R2_BASE}/venue-photos/smash-arena-thu-duc.jpg`,
        caption: "Smash Arena",
        sortOrder: 0,
      },
    });
    expect(venue.images).toHaveLength(1);
  });

  it("migrates a primary row that still holds an external (non-R2) URL", async () => {
    const venue = smashArena();
    venue.images[0].url = "https://example.com/old-photo.jpg";
    const prisma = makeFakePrisma([venue]);
    const summary = await migrateVenuePhotosToStorage(prisma as never, makeDeps());
    expect(summary.migrated).toBe(1);
    expect(venue.images[0].url).toBe(`${R2_BASE}/venue-photos/smash-arena-thu-duc.jpg`);
  });

  it("is idempotent: a second run migrates 0 (rows under the public base are skipped)", async () => {
    const venues = [smashArena()];
    const prisma = makeFakePrisma(venues);
    const deps = makeDeps();
    const first = await migrateVenuePhotosToStorage(prisma as never, deps);
    expect(first.migrated).toBe(1);
    const second = await migrateVenuePhotosToStorage(prisma as never, deps);
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(1);
    expect(deps.putFn).toHaveBeenCalledTimes(1);
  });

  it("a failed source download leaves the row untouched and is only counted", async () => {
    const venues = [smashArena()];
    const prisma = makeFakePrisma(venues);
    const deps = makeDeps({
      fetchFn: vi.fn(async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      })) as unknown as typeof fetch,
    });
    const summary = await migrateVenuePhotosToStorage(prisma as never, deps);
    expect(summary.migrated).toBe(0);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].slug).toBe("smash-arena-thu-duc");
    expect(summary.failed[0].error).toContain("404");
    expect(venues[0].images[0].url).toBe("gradient:green");
    expect(deps.putFn).not.toHaveBeenCalled();
    expect(deps.errorLog).toHaveBeenCalled();
  });

  it("a failed R2 upload leaves the row untouched and is only counted", async () => {
    const venues = [smashArena()];
    const prisma = makeFakePrisma(venues);
    const deps = makeDeps({
      putFn: vi.fn(async () => {
        throw new Error("bucket suspended");
      }),
    });
    const summary = await migrateVenuePhotosToStorage(prisma as never, deps);
    expect(summary.migrated).toBe(0);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].error).toContain("bucket suspended");
    expect(venues[0].images[0].url).toBe("gradient:green");
  });

  it("one venue's failure does not stop the others", async () => {
    const bad = smashArena();
    const good: FakeVenue = {
      id: "v-pool",
      slug: "aqua-pool-q7",
      name: "Aqua Pool",
      sports: [{ sport: { slug: "boi-loi" } }],
      images: [gradientRow("v-pool")],
    };
    const prisma = makeFakePrisma([bad, good]);
    const deps = makeDeps({
      fetchFn: vi.fn(async (url: string) => {
        if (String(url).includes("qvbadminton")) throw new Error("network down");
        return {
          ok: true,
          status: 200,
          headers: { get: () => "image/jpeg" },
          arrayBuffer: async () => new ArrayBuffer(4),
        };
      }) as unknown as typeof fetch,
    });
    const summary = await migrateVenuePhotosToStorage(prisma as never, deps);
    expect(summary.migrated).toBe(1);
    expect(summary.failed.map((f) => f.slug)).toEqual(["smash-arena-thu-duc"]);
    expect(good.images[0].url).toBe(`${R2_BASE}/venue-photos/aqua-pool-q7.jpg`);
    expect(bad.images[0].url).toBe("gradient:green");
  });

  it("skips venues with no code-map photo without fetching", async () => {
    const venue: FakeVenue = {
      id: "v-none",
      slug: "mystery-venue",
      name: "Mystery",
      sports: [{ sport: { slug: "bong-ban" } }],
      images: [gradientRow("v-none")],
    };
    const prisma = makeFakePrisma([venue]);
    const deps = makeDeps();
    const summary = await migrateVenuePhotosToStorage(prisma as never, deps);
    expect(summary).toMatchObject({ migrated: 0, skipped: 1, failed: [] });
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });
});
