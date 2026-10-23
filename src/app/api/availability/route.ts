import { NextResponse } from "next/server";
import { getAvailability } from "@/services/bookings";
import { isValidDateISO, formatTimeHHMM } from "@/lib/time/tz";

/**
 * GET /api/availability?facilityId=<id>&date=YYYY-MM-DD
 * `date` is a plain calendar date in the business timezone (Asia/Ho_Chi_Minh).
 * Slots come back as instants (ISO) plus their Saigon wall-clock label, so
 * the client never has to do date math of its own.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const facilityId = url.searchParams.get("facilityId") ?? "";
  const date = url.searchParams.get("date") ?? "";
  if (!facilityId || !isValidDateISO(date)) {
    return NextResponse.json({ error: "Tham số không hợp lệ" }, { status: 400 });
  }
  const avail = await getAvailability(facilityId, date);
  if (!avail) return NextResponse.json({ error: "Không tìm thấy sân con" }, { status: 404 });
  return NextResponse.json({
    facilityId,
    date,
    slots: avail.slots.map((s) => ({
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      startTime: formatTimeHHMM(s.startAt),
      price: s.price,
      available: s.available,
    })),
  });
}
