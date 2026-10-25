"use client";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <AlertTriangle className="mx-auto h-14 w-14 text-accent" aria-hidden />
      <h1 className="mt-4 text-2xl font-bold">{t("errorTitle")}</h1>
      <p className="mt-2 text-slate-500">{t("errorBody")}</p>
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" className="btn-primary" onClick={() => reset()}>{t("retry")}</button>
        <Link href="/" className="btn-outline">{t("backHome")}</Link>
      </div>
    </div>
  );
}
