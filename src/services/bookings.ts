import { prisma } from "@/lib/db";
import { calculatePrice, calculateRefund, isValidTransition, makeReference, ACTIVE_BOOKING_STATUSES, type CancellationPolicy } from "@/lib/booking/logic";
import { parseDateISO, weekdayOfDateISO, startOfDay, endOfDay, fromWallTime, toDateISO } from "@/lib/time/tz";
import { getPaymentProvider } from "@/lib/payments/provider";
import { notify } from "@/lib/notifications";

export interface CreateBookingInput {
  userId: string;
  facilityId: string;
  startAt: Date;
  endAt: Date;
  idempotencyKey: string;
}

/**
 * Availability for one facility on one calendar date.
 * `dateISO` is a plain "YYYY-MM-DD" calendar date in the business timezone
 * (Asia/Ho_Chi_Minh): operating hours are matched by that date's weekday and
 * slots are built as Saigon wall-clock times converted to instants. The
 * result is identical no matter what timezone the server process runs in.
 */
export interface AvailabilitySlot { startAt: Date; endAt: Date; price: number | null; available: boolean; past: boolean }

function operatingWindow(hours: { dayOfWeek: number; openTime: string; closeTime: string }[], dateISO: string) {
  const { year, month, day } = parseDateISO(dateISO);
  const schedule = hours.find((h) => h.dayOfWeek === weekdayOfDateISO(dateISO));
  if (!schedule) return null;
  const [openHour, openMinute] = schedule.openTime.split(":").map(Number);
  const [closeHour, closeMinute] = schedule.closeTime.split(":").map(Number);
  const openMinutes = openHour * 60 + openMinute;
  let closeMinutes = closeHour * 60 + closeMinute;
  if (!Number.isFinite(openMinutes) || !Number.isFinite(closeMinutes)) return null;
  if (closeMinutes <= openMinutes) closeMinutes += 1440;
  return {
    openMinutes, closeMinutes,
    startAt: fromWallTime(year, month, day, openHour, openMinute),
    endAt: fromWallTime(year, month, day, Math.floor(closeMinutes / 60), closeMinutes % 60),
  };
}

/**
 * Availability for one facility on one Saigon calendar date.
 * `db` is injectable (defaults to the app-wide client) so read-only
 * consumers like the AI assistant tools can run the EXACT same slot
 * logic against a test database — no re-implementation, no drift.
 */
export async function getAvailability(facilityId: string, dateISO: string, db: import("@prisma/client").PrismaClient = prisma) {
  const facility = await db.facility.findUnique({
    where: { id: facilityId },
    include: { venue: { include: { hours: true } }, priceRules: true },
  });
  if (!facility || facility.venue.status !== "APPROVED") return null;
  const dayStart = startOfDay(dateISO);
  const dayEnd = endOfDay(dateISO);
  const previousDateISO = toDateISO(new Date(dayStart.getTime() - 1));
  const startTimes: number[] = [];
  for (const scheduleDate of [previousDateISO, dateISO]) {
    const window = operatingWindow(facility.venue.hours, scheduleDate);
    if (!window) continue;
    for (let m = window.openMinutes; m + 60 <= window.closeMinutes; m += 60) {
      const instant = window.startAt.getTime() + (m - window.openMinutes) * 60_000;
      if (instant >= dayStart.getTime() && instant < dayEnd.getTime()) startTimes.push(instant);
    }
  }
  const starts = [...new Set(startTimes)].sort((a, b) => a - b);
  // shortcut: Date-scoped slots omit multi-hour starts crossing midnight; combine adjacent dates when that journey is needed.
  if (starts.length === 0) return { facility, slots: [] as AvailabilitySlot[] };
  const rangeEnd = new Date(starts[starts.length - 1] + 3_600_000);
  const bookings = await db.booking.findMany({
    where: { facilityId, status: { in: ACTIVE_BOOKING_STATUSES }, startAt: { lt: rangeEnd }, endAt: { gt: dayStart } },
  });
  const blocked = await db.blockedTime.findMany({
    where: { facilityId, startAt: { lt: rangeEnd }, endAt: { gt: dayStart } },
  });
  const slots: AvailabilitySlot[] = [];
  const now = Date.now();
  for (const instant of starts) {
    const s = new Date(instant);
    const e = new Date(s.getTime() + 3_600_000);
    const conflict =
      bookings.some((b) => s.getTime() < b.endAt.getTime() && b.startAt.getTime() < e.getTime()) ||
      blocked.some((b) => s.getTime() < b.endAt.getTime() && b.startAt.getTime() < e.getTime());
    const price = facility.priceRules.length ? calculatePrice(facility.priceRules, s, e).total : null;
    // A slot is bookable only while its start is strictly in the future —
    // the same boundary createBooking enforces (IN_THE_PAST). Anything at
    // or before `now` is reported as `past` so the UI can label it
    // "already passed" instead of offering it and failing at confirm.
    const past = s.getTime() <= now;
    slots.push({ startAt: s, endAt: e, price, available: price !== null && !conflict && !past, past });
  }
  return { facility, slots };
}

export async function createBooking(input: CreateBookingInput) {
  function sameRequest(booking: { userId: string; facilityId: string; startAt: Date; endAt: Date }) {
    if (booking.userId !== input.userId || booking.facilityId !== input.facilityId ||
        booking.startAt.getTime() !== input.startAt.getTime() || booking.endAt.getTime() !== input.endAt.getTime()) {
      throw new Error("IDEMPOTENCY_CONFLICT");
    }
  }
  // A retry may return only this user's booking for the exact same request.
  const existing = await prisma.booking.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) { sameRequest(existing); return { booking: existing, created: false }; }

  const facility = await prisma.facility.findUnique({
    where: { id: input.facilityId },
    include: { venue: { include: { hours: true } }, priceRules: true },
  });
  if (!facility) throw new Error("FACILITY_NOT_FOUND");
  if (facility.venue.status !== "APPROVED") throw new Error("VENUE_NOT_APPROVED");
  if (input.endAt <= input.startAt) throw new Error("INVALID_RANGE");
  if (input.startAt.getTime() < Date.now() - 60_000) throw new Error("IN_THE_PAST");
  const dateISO = toDateISO(input.startAt);
  const previousDateISO = toDateISO(new Date(startOfDay(dateISO).getTime() - 1));
  const insideHours = [dateISO, previousDateISO].some((date) => {
    const window = operatingWindow(facility.venue.hours, date);
    return window && input.startAt >= window.startAt && input.endAt <= window.endAt;
  });
  if (!insideHours) {
    throw new Error("OUTSIDE_OPENING_HOURS");
  }

  // Server-side price — client price is never trusted
  const price = calculatePrice(facility.priceRules, input.startAt, input.endAt);
  const policy: CancellationPolicy = {
    fullBeforeHours: facility.venue.cancelFullBeforeHours,
    partialBeforeHours: facility.venue.cancelPartialBeforeHours,
    partialFeePercent: facility.venue.cancelPartialFeePercent,
  };
  const status = facility.venue.instantBooking ? "CONFIRMED" : "PENDING";
  const reference = makeReference();

  const result = await prisma.$transaction(async (tx) => {
    // Re-check idempotency + overlap INSIDE the transaction
    const dup = await tx.booking.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (dup) { sameRequest(dup); return { booking: dup, created: false }; }
    const conflicts = await tx.booking.findMany({
      where: {
        facilityId: input.facilityId,
        status: { in: ACTIVE_BOOKING_STATUSES },
        startAt: { lt: input.endAt },
        endAt: { gt: input.startAt },
      },
    });
    if (conflicts.length > 0) throw new Error("SLOT_TAKEN");
    const blocked = await tx.blockedTime.findMany({
      where: { facilityId: input.facilityId, startAt: { lt: input.endAt }, endAt: { gt: input.startAt } },
    });
    if (blocked.length > 0) throw new Error("SLOT_BLOCKED");

    const created = await tx.booking.create({
      data: {
        reference, userId: input.userId, venueId: facility.venueId, facilityId: input.facilityId,
        startAt: input.startAt, endAt: input.endAt, status,
        totalPrice: price.total,
        priceSnapshot: JSON.stringify(price.breakdown),
        policySnapshot: JSON.stringify(policy),
        idempotencyKey: input.idempotencyKey,
      },
    });
    await tx.bookingStatusHistory.create({ data: { bookingId: created.id, fromStatus: null, toStatus: status, actorId: input.userId, note: "Tạo đặt sân" } });
    await tx.idempotencyKey.create({ data: { key: input.idempotencyKey, userId: input.userId, resultId: created.id } });
    const provider = getPaymentProvider();
    const charge = await provider.charge({ amount: price.total, currency: "VND", reference });
    await tx.payment.create({
      data: { bookingId: created.id, userId: input.userId, provider: provider.name, status: charge.status, amount: price.total, simulated: provider.simulated },
    });
    return { booking: created, created: true };
  }).catch(async (error: unknown) => {
    if ((error as { code?: string }).code === "P2002") {
      const duplicate = await prisma.booking.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (duplicate) { sameRequest(duplicate); return { booking: duplicate, created: false }; }
    }
    throw error;
  });

  if (!result.created) return result;
  const { booking } = result;

  await notify(input.userId, "BOOKING", status === "CONFIRMED" ? "Đặt sân thành công" : "Đặt sân đang chờ duyệt",
    `Mã ${booking.reference} — tổng ${booking.totalPrice.toLocaleString("vi-VN")} đ.`,
    booking.id, `booking-created-${booking.id}`);
  if (status === "PENDING") {
    await notify(facility.venue.ownerId, "BOOKING_PENDING", "Có yêu cầu đặt sân mới", `Mã ${booking.reference} đang chờ bạn duyệt.`, booking.id, `booking-pending-${booking.id}`);
  }
  return result;
}

export async function transitionBooking(bookingId: string, toStatus: string, actorId: string, note?: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { venue: true } });
  if (!booking) throw new Error("BOOKING_NOT_FOUND");
  if (!isValidTransition(booking.status, toStatus)) throw new Error(`INVALID_TRANSITION:${booking.status}->${toStatus}`);
  let refundAmount: number | undefined;
  if (toStatus === "CANCELLED") {
    const policy = JSON.parse(booking.policySnapshot) as CancellationPolicy;
    refundAmount = calculateRefund(booking.totalPrice, booking.startAt, new Date(), policy).refundAmount;
  }
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.booking.update({ where: { id: bookingId, status: booking.status }, data: { status: toStatus, refundAmount } });
    await tx.bookingStatusHistory.create({ data: { bookingId, fromStatus: booking.status, toStatus, actorId, note } });
    if (toStatus === "CANCELLED" && refundAmount !== undefined && refundAmount > 0) {
      await tx.payment.create({ data: { bookingId, userId: booking.userId, provider: "SIMULATED", status: "REFUNDED_SIMULATED", amount: -refundAmount, simulated: true } });
    }
    return u;
  }).catch((error: unknown) => {
    if ((error as { code?: string }).code === "P2025") throw new Error("BOOKING_STATE_CHANGED");
    throw error;
  });
  await notify(booking.userId, "BOOKING", `Cập nhật đặt sân ${booking.reference}`, `Trạng thái mới: ${toStatus}${refundAmount !== undefined ? ` — hoàn: ${refundAmount.toLocaleString("vi-VN")} đ` : ""}`, booking.id, `booking-${booking.id}-${toStatus}-${Date.now()}`);
  return updated;
}

export function refundPreview(booking: { totalPrice: number; startAt: Date; policySnapshot: string }) {
  const policy = JSON.parse(booking.policySnapshot) as CancellationPolicy;
  return calculateRefund(booking.totalPrice, booking.startAt, new Date(), policy);
}
