import { afterAll, beforeAll, expect, it } from "vitest";
import { createAiFixtureDb, type AiFixtureDb } from "./ai/fixtures";
import { ensureBookingConstraint } from "../prisma/booking-constraint";

let fixture: AiFixtureDb;
beforeAll(async () => { fixture = await createAiFixtureDb(); }, 90_000);
afterAll(async () => { await fixture?.cleanup(); });

it("excludes overlapping concurrent bookings and releases cancelled bookings", async () => {
  const db = fixture.db;
  await ensureBookingConstraint(db); // Reapplying must be harmless.
  const user = await db.user.findFirstOrThrow();
  const booking = (key: string) => db.booking.create({ data: {
    reference: key, idempotencyKey: key, userId: user.id, venueId: "v_thuduc", facilityId: "f_thuduc",
    startAt: new Date("2030-01-07T10:00:00Z"), endAt: new Date("2030-01-07T11:00:00Z"),
    status: "CONFIRMED", totalPrice: 100000, priceSnapshot: "{}", policySnapshot: "{}",
  } });
  const results = await Promise.allSettled([booking("race-a"), booking("race-b")]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(await db.booking.count({ where: { reference: { in: ["race-a", "race-b"] } } })).toBe(1);
  await db.booking.updateMany({ where: { reference: { in: ["race-a", "race-b"] } }, data: { status: "CANCELLED" } });
  await expect(booking("race-after-cancel")).resolves.toMatchObject({ status: "CONFIRMED" });
});

it("ensures the constraint for a second schema while the first still exists", async () => {
  const second = await createAiFixtureDb();
  try {
    const rows = await second.db.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM pg_constraint
      WHERE conname = 'booking_no_overlap_active' AND conrelid = '"Booking"'::regclass`;
    expect(rows[0].count).toBe(1);
  } finally { await second.cleanup(); }
}, 90_000);
