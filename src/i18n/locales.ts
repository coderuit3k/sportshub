/**
 * Shared locale constants (client-safe — no server imports).
 * The active locale is stored in the `NEXT_LOCALE` cookie; see
 * src/i18n/request.ts for how the server reads it.
 */
export const locales = ["vi", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "vi";
export const LOCALE_COOKIE = "NEXT_LOCALE";
