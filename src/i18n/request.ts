import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, locales, LOCALE_COOKIE, type Locale } from "./locales";

/**
 * Cookie-based i18n (no URL restructuring): the active locale comes from
 * the `NEXT_LOCALE` cookie set by the navbar LanguageSwitcher and falls
 * back to Vietnamese. See docs/architecture.md → "Internationalization".
 */
export { defaultLocale, locales, LOCALE_COOKIE, type Locale };

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: Locale = (locales as readonly string[]).includes(cookieLocale ?? "")
    ? (cookieLocale as Locale)
    : defaultLocale;
  return {
    locale,
    // All business dates are Asia/Ho_Chi_Minh wall-clock (see src/lib/time/tz.ts);
    // formatters inherit this so vi/en render the same instants.
    timeZone: "Asia/Ho_Chi_Minh",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
