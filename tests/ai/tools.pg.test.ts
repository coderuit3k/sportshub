/**
 * Production-database (PostgreSQL) behaviour tests for the booking-
 * critical AI tools — the same fixture design and hand-computed
 * expectations as the integration suite, run against the
 * repo's postgresql schema.
 *
 * Required: TEST_DATABASE_URL points at a THROWAWAY test
 * database, e.g.
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/ai_test \
 *     npx vitest run tests/ai/tools.pg.test.ts
 * (The tsrange exclusion constraint itself is applied by deploy-db,
 * not by db push, and was verified on production PostgreSQL earlier;
 * these tests cover the tools' read/quote behaviour on PG.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createAiFixturePgDb, fixtureCtx, FRI, SAT } from "./fixtures";
import { searchVenues } from "@/lib/ai/tools/search-venues";
import { getReviewSummaryStats } from "@/lib/ai/tools/review-stats";
import { getBookableOptions } from "@/lib/ai/tools/bookable-options";
import { prepareBookingHandoff } from "@/lib/ai/tools/handoff";

const PG_URL = process.env.TEST_DATABASE_URL;

describe("AI tools on PostgreSQL", () => {
  let db: PrismaClient;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const f = await createAiFixturePgDb(PG_URL!);
    db = f.db;
    cleanup = f.cleanup;
  }, 90_000);
  afterAll(async () => { await cleanup?.(); });

  it("search uses the effective rating identically on PG", async () => {
    const res = await searchVenues(fixtureCtx(db), { sportSlug: "cau-long", minRating: 4.5, limit: 5 });
    expect(res.data!.venues.map((v) => v.venueId)).toEqual(["v_thuduc"]);
  });

  it("stats keep the three populations separate on PG", async () => {
    const res = await getReviewSummaryStats(fixtureCtx(db), { venueIds: ["v_thuduc"], source: "all" });
    const v = res.data!.venues[0];
    expect(v.googleAggregate).toEqual({ rating: 4.6, count: 1200 });
    expect(v.googleSample!.reviewCount).toBe(5);
    expect(v.inApp!.reviewCount).toBe(1);
    expect(v.inApp!.seedReviewCount).toBe(1);
  });

  it("availability conflicts and peak-boundary pricing are exact on PG", async () => {
    const sat = await getBookableOptions(fixtureCtx(db), { venueId: "v_thuduc", date: SAT, durationHours: 1 });
    const byStart = new Map(sat.data!.options.map((o) => [o.startTime, o]));
    expect(byStart.get("18:00")!.slotAvailable).toBe(false); // CONFIRMED booking
    expect(byStart.get("20:00")!.slotAvailable).toBe(false); // BlockedTime
    expect(byStart.get("17:00")!.slotAvailable).toBe(true);
    const fri = await getBookableOptions(fixtureCtx(db), { venueId: "v_thuduc", date: FRI, durationHours: 2, preferredStartTime: "16:00" });
    expect(fri.data!.options[0].pricePerHourBreakdown!.map((b) => b.pricePerHour)).toEqual([80_000, 120_000]);
    expect(fri.data!.options[0].totalPrice).toBe(200_000);
  });

  it("handoff validates freshly and writes nothing on PG", async () => {
    const before = await db.booking.count();
    const ok = await prepareBookingHandoff(fixtureCtx(db), {
      venueId: "v_thuduc", facilityId: "f_thuduc", date: SAT, startTime: "17:00", durationHours: 1,
    });
    expect(ok.status).toBe("ok");
    expect(ok.data!.totalPrice).toBe(100_000);
    const taken = await prepareBookingHandoff(fixtureCtx(db), {
      venueId: "v_thuduc", facilityId: "f_thuduc", date: SAT, startTime: "18:00", durationHours: 1,
    });
    expect(taken.error!.code).toBe("SLOT_UNAVAILABLE");
    expect(await db.booking.count()).toBe(before);
  });
});
