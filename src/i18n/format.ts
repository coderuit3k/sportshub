/**
 * Shared date-time rendering for server components: the same options the
 * app previously passed to `toLocaleString("vi-VN", …)` (Saigon wall
 * clock, 24h), now driven by the active locale via next-intl's
 * formatter — `14:00:00 24/10/2026` (vi) vs `10/24/2026, 14:00:00` (en).
 */
export const DATE_TIME_OPTIONS = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Ho_Chi_Minh",
} as const;
