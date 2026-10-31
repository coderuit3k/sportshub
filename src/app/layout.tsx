import type { Metadata } from "next";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/inter";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";
import Header from "@/components/Header";

export const metadata: Metadata = {
  title: { default: "SportsHub — Find Your Sport. Find Your Court. Find Your People.", template: "%s | SportsHub" },
  description: "Nền tảng khám phá, đặt sân và kết nối cộng đồng thể thao tại Việt Nam.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Cookie-based locale (NEXT_LOCALE, see src/i18n/request.ts) — no URL
  // restructuring; the provider hands locale + messages to client components.
  const locale = await getLocale();
  const messages = await getMessages();
  const t = await getTranslations("footer");
  return (
    <html lang={locale}>
      <body className="font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Header />
          <main className="mx-auto min-h-[70vh] max-w-7xl px-4 py-6">{children}</main>
          <footer className="mt-12 bg-ink text-slate-300">
            <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 text-sm md:grid-cols-3">
              <div><p className="mb-2 text-base font-bold text-white">SportsHub Vietnam</p><p>{t("tagline")}</p></div>
              <div><p className="mb-2 font-bold text-white">{t("contact")}</p><p>{t("contactCity")}<br />hotro@sportshub.example</p></div>
              <div><p className="mb-2 font-bold text-white">{t("policy")}</p><p>{t("policyBody")}</p></div>
            </div>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
