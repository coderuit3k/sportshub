"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import PasswordInput from "@/components/PasswordInput";
export default function LoginPage() {
  const t = useTranslations("auth");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-md">
      <form className="card space-y-4 p-6" onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }) });
        const j = (await r.json()) as { error?: string };
        // API error strings stay Vietnamese (known i18n gap); only the
        // client-side fallback message is localized.
        if (!r.ok) { setError(j.error ?? t("loginFailed")); return; }
        window.location.href = "/";
      }}>
        <h1 className="text-2xl font-bold">{t("loginTitle")}</h1>
        <div><label className="label" htmlFor="email">{t("email")}</label><input id="email" name="email" type="email" required className="input" autoComplete="email" /></div>
        <div><label className="label" htmlFor="password">{t("password")}</label><PasswordInput id="password" name="password" required className="input" autoComplete="current-password" /></div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" type="submit">{t("loginSubmit")}</button>
        <p className="text-sm">{t("noAccount")} <a className="font-semibold text-primary" href="/register">{t("registerLink")}</a></p>
      </form>
    </div>
  );
}
