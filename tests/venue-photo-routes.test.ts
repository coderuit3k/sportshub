import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner venue-photo routes (Cloudflare R2):
 *  - POST   /api/owner/venue-photo/upload   (presign an R2 PUT URL)
 *  - POST   /api/owner/venue-photo          (persist an uploaded photo URL)
 *  - DELETE /api/owner/venue-photo          (revert to the default photo)
 *
 * Prisma, the session, next/cache and the AWS SDK (S3 client +
 * presigner) are mocked; R2 is configured per-test through the five
 * R2_* env vars. The rules under test: only the venue's owner /
 * staff / an ADMIN may presign, persist or remove; presign validates
 * content type (jpeg/png/webp) and size (≤ 8 MB); persist accepts
 * only URLs under OUR R2_PUBLIC_BASE_URL; removing reverts the
 * primary row to the gradient placeholder and best-effort deletes
 * the R2 object; without the R2 env vars the presign route answers
 * 503 STORAGE_NOT_CONFIGURED.
 */

const R2_ENV: Record<string, string> = {
  R2_ACCOUNT_ID: "acct-123",
  R2_ACCESS_KEY_ID: "key-id",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "sportshub-photos",
  R2_PUBLIC_BASE_URL: "https://pub-abc123.r2.dev",
};
const PHOTO_URL = `${R2_ENV.R2_PUBLIC_BASE_URL}/venue-photos/test-venue-1699999999999.jpg`;
const PHOTO_KEY = "venue-photos/test-venue-1699999999999.jpg";

interface Row {
  id: string;
  venueId: string;
  url: string;
  caption: string | null;
  sortOrder: number;
}

const state = vi.hoisted(() => ({
  currentUser: null as { id: string; role: string } | null,
  venues: [] as Array<{
    id: string;
    slug: string;
    name: string;
    ownerId: string;
    staff: Array<{ id: string; userId: string }>;
  }>,
  images: [] as Row[],
  s3Commands: [] as Array<{ name: string; input: Record<string, unknown> }>,
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => state.currentUser),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    venue: {
      findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: { staff?: { where: { userId: string } } } }) => {
        const venue = state.venues.find((v) => v.id === where.id);
        if (!venue) return null;
        const staffFilter = include?.staff?.where?.userId;
        return {
          ...venue,
          staff: staffFilter ? venue.staff.filter((s) => s.userId === staffFilter) : venue.staff,
        };
      }),
    },
    venueImage: {
      findFirst: vi.fn(async ({ where }: { where: { venueId: string } }) => {
        const rows = state.images
          .filter((r) => r.venueId === where.venueId)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        return rows[0] ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { url: string } }) => {
        const row = state.images.find((r) => r.id === where.id);
        if (row) row.url = data.url;
        return row;
      }),
      create: vi.fn(async ({ data }: { data: Omit<Row, "id"> }) => {
        const row: Row = { id: `img-${state.images.length + 1}`, ...data };
        state.images.push(row);
        return row;
      }),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class DeleteObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class S3Client {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      state.s3Commands.push({ name: command.constructor.name, input: command.input });
      return {};
    }
    destroy() {}
  }
  return { S3Client, PutObjectCommand, DeleteObjectCommand };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(
    async (_client: unknown, command: { input: { Key: string } }, options: { expiresIn: number }) =>
      `https://acct-123.r2.cloudflarestorage.com/sportshub-photos/${command.input.Key}?sig=test&exp=${options.expiresIn}`,
  ),
}));

import { POST as persistPOST, DELETE as persistDELETE } from "@/app/api/owner/venue-photo/route";
import { POST as presignPOST } from "@/app/api/owner/venue-photo/upload/route";

const OWNER = { id: "owner-1", role: "OWNER" };
const STAFF = { id: "staff-1", role: "OWNER" };
const ADMIN = { id: "admin-1", role: "ADMIN" };
const STRANGER = { id: "player-9", role: "PLAYER" };

function seedVenue(withRow: boolean) {
  state.venues = [
    {
      id: "venue-1",
      slug: "test-venue",
      name: "Test Venue",
      ownerId: OWNER.id,
      staff: [{ id: "staff-row-1", userId: STAFF.id }],
    },
  ];
  state.images = withRow
    ? [{ id: "img-1", venueId: "venue-1", url: "gradient:green", caption: "Test Venue", sortOrder: 0 }]
    : [];
  state.s3Commands = [];
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const persistRequest = (method: string, body: unknown) =>
  jsonRequest("http://test/api/owner/venue-photo", method, body);
const presignRequest = (body: unknown) =>
  jsonRequest("http://test/api/owner/venue-photo/upload", "POST", body);

function setR2Env() {
  Object.assign(process.env, R2_ENV);
}
function clearR2Env() {
  for (const key of Object.keys(R2_ENV)) delete process.env[key];
}

beforeEach(() => {
  state.currentUser = null;
  clearR2Env();
});
afterEach(() => {
  clearR2Env();
});

describe("POST /api/owner/venue-photo (persist)", () => {
  it("requires login", async () => {
    seedVenue(true);
    setR2Env();
    const res = await persistPOST(persistRequest("POST", { venueId: "venue-1", photoUrl: PHOTO_URL }));
    expect(res.status).toBe(401);
  });

  it("rejects a user who does not manage the venue", async () => {
    seedVenue(true);
    setR2Env();
    state.currentUser = STRANGER;
    const res = await persistPOST(persistRequest("POST", { venueId: "venue-1", photoUrl: PHOTO_URL }));
    expect(res.status).toBe(403);
    expect(state.images[0].url).toBe("gradient:green");
  });

  it("404s for a missing venue", async () => {
    seedVenue(true);
    setR2Env();
    state.currentUser = OWNER;
    const res = await persistPOST(persistRequest("POST", { venueId: "nope", photoUrl: PHOTO_URL }));
    expect(res.status).toBe(404);
  });

  it("rejects URLs that are not under our R2 public base", async () => {
    seedVenue(true);
    setR2Env();
    state.currentUser = OWNER;
    for (const foreign of [
      "https://images.unsplash.com/photo-1",
      "https://pub-abc123.r2.dev.evil.com/venue-photos/x.jpg",
      "https://pub-other999.r2.dev/venue-photos/x.jpg",
      "https://thumb.wikimedia.org/x.jpg",
    ]) {
      const res = await persistPOST(persistRequest("POST", { venueId: "venue-1", photoUrl: foreign }));
      expect(res.status, foreign).toBe(400);
    }
    expect(state.images[0].url).toBe("gradient:green");
  });

  it("owner persists the R2 URL onto the primary row", async () => {
    seedVenue(true);
    setR2Env();
    state.currentUser = OWNER;
    const res = await persistPOST(persistRequest("POST", { venueId: "venue-1", photoUrl: PHOTO_URL }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, imageUrl: PHOTO_URL });
    expect(state.images[0].url).toBe(PHOTO_URL);
  });

  it("staff and ADMIN may also persist", async () => {
    seedVenue(true);
    setR2Env();
    state.currentUser = STAFF;
    expect((await persistPOST(persistRequest("POST", { venueId: "venue-1", photoUrl: PHOTO_URL }))).status).toBe(200);
    seedVenue(true);
    state.currentUser = ADMIN;
    expect((await persistPOST(persistRequest("POST", { venueId: "venue-1", photoUrl: PHOTO_URL }))).status).toBe(200);
  });

  it("creates the primary row when the venue has none", async () => {
    seedVenue(false);
    setR2Env();
    state.currentUser = OWNER;
    const res = await persistPOST(persistRequest("POST", { venueId: "venue-1", photoUrl: PHOTO_URL }));
    expect(res.status).toBe(200);
    expect(state.images).toHaveLength(1);
    expect(state.images[0]).toMatchObject({ venueId: "venue-1", url: PHOTO_URL, sortOrder: 0 });
  });
});

describe("DELETE /api/owner/venue-photo (revert to default)", () => {
  it("reverts the row to the placeholder and deletes the R2 object", async () => {
    seedVenue(true);
    setR2Env();
    state.images[0].url = PHOTO_URL;
    state.currentUser = OWNER;
    const res = await persistDELETE(persistRequest("DELETE", { venueId: "venue-1" }));
    expect(res.status).toBe(200);
    expect(state.images[0].url).toBe("gradient:green");
    expect(state.s3Commands).toEqual([
      { name: "DeleteObjectCommand", input: { Bucket: "sportshub-photos", Key: PHOTO_KEY } },
    ]);
  });

  it("rejects a user who does not manage the venue", async () => {
    seedVenue(true);
    setR2Env();
    state.images[0].url = PHOTO_URL;
    state.currentUser = STRANGER;
    const res = await persistDELETE(persistRequest("DELETE", { venueId: "venue-1" }));
    expect(res.status).toBe(403);
    expect(state.images[0].url).toBe(PHOTO_URL);
    expect(state.s3Commands).toEqual([]);
  });

  it("requires login", async () => {
    seedVenue(true);
    setR2Env();
    const res = await persistDELETE(persistRequest("DELETE", { venueId: "venue-1" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/owner/venue-photo/upload (presign)", () => {
  it("answers 503 STORAGE_NOT_CONFIGURED when R2 is not configured", async () => {
    seedVenue(true);
    state.currentUser = OWNER;
    const res = await presignPOST(presignRequest({ venueId: "venue-1", contentType: "image/png", size: 1024 }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "STORAGE_NOT_CONFIGURED" });
  });

  it("requires login", async () => {
    seedVenue(true);
    setR2Env();
    const res = await presignPOST(presignRequest({ venueId: "venue-1", contentType: "image/png", size: 1024 }));
    expect(res.status).toBe(401);
  });

  it("rejects a user who does not manage the venue", async () => {
    seedVenue(true);
    setR2Env();
    state.currentUser = STRANGER;
    const res = await presignPOST(presignRequest({ venueId: "venue-1", contentType: "image/png", size: 1024 }));
    expect(res.status).toBe(403);
  });

  it("validates content type and size", async () => {
    seedVenue(true);
    setR2Env();
    state.currentUser = OWNER;
    expect(
      (await presignPOST(presignRequest({ venueId: "venue-1", contentType: "image/gif", size: 1024 }))).status,
    ).toBe(400);
    expect(
      (await presignPOST(presignRequest({ venueId: "venue-1", contentType: "image/png", size: 9 * 1024 * 1024 }))).status,
    ).toBe(400);
  });

  it("issues a presigned PUT URL and the matching public URL for the owner", async () => {
    seedVenue(true);
    setR2Env();
    state.currentUser = OWNER;
    const res = await presignPOST(presignRequest({ venueId: "venue-1", contentType: "image/png", size: 2048 }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { uploadUrl: string; publicUrl: string; key: string };
    expect(data.key).toMatch(/^venue-photos\/test-venue-\d+\.png$/);
    expect(data.publicUrl).toBe(`${R2_ENV.R2_PUBLIC_BASE_URL}/${data.key}`);
    expect(data.uploadUrl).toContain(data.key);
    expect(data.uploadUrl).toContain("exp=300");
  });

  it("staff and ADMIN may also presign", async () => {
    seedVenue(true);
    setR2Env();
    state.currentUser = STAFF;
    expect(
      (await presignPOST(presignRequest({ venueId: "venue-1", contentType: "image/jpeg", size: 10 }))).status,
    ).toBe(200);
    state.currentUser = ADMIN;
    expect(
      (await presignPOST(presignRequest({ venueId: "venue-1", contentType: "image/webp", size: 10 }))).status,
    ).toBe(200);
  });
});
