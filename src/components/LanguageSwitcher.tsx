"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, Globe } from "lucide-react";
import { LOCALE_COOKIE, type Locale } from "@/i18n/locales";

/**
 * Navbar language switcher (vi/en). Locale is cookie-based (no URL
 * routing): picking a language sets the `NEXT_LOCALE` cookie for a year
 * and reloads the page so the root layout (incl. `<html lang>`) and all
 * server components re-render in the new locale — `router.refresh()`
 * alone does not patch `<html>` attributes. Rendered in the header's top
 * bar, so it is present in both the desktop and mobile nav.
 */
const OPTIONS: { code: Locale; short: string; label: string }[] = [
  { code: "vi", short: "VI", label: "Tiếng Việt" },
  { code: "en", short: "EN", label: "English" },
];

export default function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open ]);

  function pick(code: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    setOpen(false);
    window.location.reload();
  }

  const current = OPTIONS.find((o) => o.code === locale) ?? OPTIONS[0];
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("languageLabel")}
        className="flex items-center gap-1 rounded-lg border border-white/40 px-2.5 py-1.5 font-medium hover:bg-white/10"
      >
        <Globe className="h-4 w-4" />
        <span>{current.short}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t("languageLabel")}
          className="absolute right-0 z-50 mt-2 w-40 overflow-hidden rounded-xl bg-white text-sm text-ink shadow-lg ring-1 ring-black/10"
        >
          {OPTIONS.map((o) => (
            <li key={o.code}>
              <button
                type="button"
                role="option"
                aria-selected={o.code === locale}
                onClick={() => pick(o.code)}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-100"
              >
                <span>
                  {o.label} <span className="text-slate-400">({o.short})</span>
                </span>
                {o.code === locale && <Check className="h-4 w-4 text-primary" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
