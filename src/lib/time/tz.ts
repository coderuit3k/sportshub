// Business-timezone helpers.
//
// SportsHub operates in Vietnam: the business timezone is Asia/Ho_Chi_Minh.
// ALL booking math — weekday lookup, price-rule hour, day boundaries, slot
// instants — is anchored to this timezone via Intl, NEVER to the server
// process timezone. (Production runs on Vercel where the process TZ is UTC;
// using Date.getDay()/getHours()/setHours() there silently shifted every
// slot by 7 hours. This module exists so that class of bug cannot return.)
//
// Dependency-free: built on Intl.DateTimeFormat only, safe to import from
// server components, API routes, services and client components alike.

export const BUSINESS_TZ = "Asia/Ho_Chi_Minh";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23", // hours 00–23 (h24 can yield "24" at midnight)
  weekday: "short",
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export interface WallClockParts {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
  hour: number; // 0–23
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday — same convention as Date.getDay() and OperatingHour.dayOfWeek. */
  weekday: number;
}

/** Wall-clock parts of an instant as seen in Asia/Ho_Chi_Minh. */
export function wallClockParts(instant: Date): WallClockParts {
  const map: Record<string, string> = {};
  for (const p of partsFmt.formatToParts(instant)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_INDEX[map.weekday] ?? 0,
  };
}

/**
 * Offset of the business timezone relative to UTC, in ms, at an instant
 * (wallClock = utc + offset). Computed from Intl — not a hardcoded +7 — so
 * it stays correct even if tz rules ever change.
 */
function tzOffsetMs(instant: Date): number {
  const p = wallClockParts(instant);
  const wallAsUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Parts carry second precision; drop sub-second from the instant.
  return wallAsUtcMs - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant for a wall-clock time in Asia/Ho_Chi_Minh.
 * Two-pass offset resolution: guess, measure the offset at the guess,
 * re-derive, and correct once more if the offset changed (DST guard —
 * Vietnam has no DST, but this keeps the function honest).
 */
export function fromWallTime(
  year: number,
  month: number, // 1–12
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const wallAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = tzOffsetMs(new Date(wallAsUtcMs));
  let utcMs = wallAsUtcMs - offset1;
  const offset2 = tzOffsetMs(new Date(utcMs));
  if (offset2 !== offset1) utcMs = wallAsUtcMs - offset2;
  return new Date(utcMs);
}

const DATE_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CalendarDate { year: number; month: number; day: number }

/** Parse a plain calendar date "YYYY-MM-DD". Throws on malformed/impossible dates. */
export function parseDateISO(dateISO: string): CalendarDate {
  const m = DATE_ISO_RE.exec(dateISO);
  if (!m) throw new Error("INVALID_DATE");
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  // Reject impossible dates (e.g. 2026-02-31) via UTC round-trip.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error("INVALID_DATE");
  }
  return { year, month, day };
}

export function isValidDateISO(dateISO: string): boolean {
  try { parseDateISO(dateISO); return true; } catch { return false; }
}

/** Format calendar parts as "YYYY-MM-DD". */
export function formatDateISO(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The Saigon calendar date ("YYYY-MM-DD") that an instant falls on. */
export function toDateISO(instant: Date): string {
  const p = wallClockParts(instant);
  return formatDateISO(p.year, p.month, p.day);
}

/** Today's calendar date in Asia/Ho_Chi_Minh, as "YYYY-MM-DD". */
export function todayDateISO(now: Date = new Date()): string {
  return toDateISO(now);
}

/** Weekday (0 = Sunday … 6 = Saturday) of a plain calendar date. Pure calendar math — TZ-independent. */
export function weekdayOfDateISO(dateISO: string): number {
  const { year, month, day } = parseDateISO(dateISO);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Instant at which a Saigon calendar date begins (00:00 Asia/Ho_Chi_Minh). */
export function startOfDay(dateISO: string): Date {
  const { year, month, day } = parseDateISO(dateISO);
  return fromWallTime(year, month, day, 0, 0, 0);
}

/** Instant at which a Saigon calendar date ends — i.e. start of the next calendar date. */
export function endOfDay(dateISO: string): Date {
  const { year, month, day } = parseDateISO(dateISO);
  const next = new Date(Date.UTC(year, month - 1, day + 1)); // normalizes month/year rollover
  return fromWallTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, 0);
}

/** "HH:MM" wall-clock label (Asia/Ho_Chi_Minh) for an instant. */
export function formatTimeHHMM(instant: Date): string {
  const p = wallClockParts(instant);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Instant for a Saigon wall-clock date + time, e.g.
 * ("2026-10-24", "14:00") → 2026-10-24T07:00:00Z.
 * Use for values coming from <input type="date"> / datetime-local, whose
 * strings are wall-clock readings — never parse them with `new Date(str)`
 * (that anchors them to the runtime's local timezone).
 */
export function saigonDateTimeToInstant(dateISO: string, timeHHMM: string): Date {
  const { year, month, day } = parseDateISO(dateISO);
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeHHMM);
  if (!m) throw new Error("INVALID_TIME");
  return fromWallTime(year, month, day, Number(m[1]), Number(m[2]), Number(m[3] ?? 0));
}
