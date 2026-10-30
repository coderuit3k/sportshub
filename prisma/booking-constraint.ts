import type { PrismaClient } from "@prisma/client";

export async function ensureBookingConstraint(db: PrismaClient): Promise<void> {
  await db.$transaction(async (tx) => {
    // Extension creation is database-wide, including concurrent isolated test schemas.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(173921, 1)`;
    await tx.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public");
    const rows = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM pg_constraint
      WHERE conname = 'booking_no_overlap_active' AND conrelid = '"Booking"'::regclass`;
    if (rows[0]?.n === 0) {
      await tx.$executeRawUnsafe(`ALTER TABLE "Booking" ADD CONSTRAINT booking_no_overlap_active
        EXCLUDE USING gist ("facilityId" WITH =, tsrange("startAt", "endAt") WITH &&)
        WHERE ("status" IN ('PENDING', 'CONFIRMED'))`);
    }
  });
}
