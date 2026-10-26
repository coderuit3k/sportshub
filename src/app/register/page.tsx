"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import PasswordInput from "@/components/PasswordInput";
export default function RegisterPage() {
  const t = useTranslations("auth");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-md">
      <form className="card space-y-4 p-6" onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const r = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: fd.get("name"), email: fd.get("email"), password: fd.get("password"), role: fd.get("role") }) });
        const j = (await r.json()) as { error?: string };
        // API error strings stay Vietnamese (known i18n gap); only the
        // client-side fallback message is localized.
        if (!r.ok) { setError(j.error ?? t("registerFailed")); return; }
        window.location.href = "/";
      }}>
        <h1 className="text-2xl font-bold">{t("registerTitle")}</h1>
        <div><label className="label" htmlFor="name">{t("name")}</label><input id="name" name="name" required className="input" /></div>
        <div><label className="label" htmlFor="email">{t("email")}</label><input id="email" name="email" type="email" required className="input" autoComplete="email" /></div>
        <div><label className="label" htmlFor="password">{t("passwordHint")}</label><PasswordInput id="password" name="password" required minLength={8} className="input" autoComplete="new-password" /></div>
        <div><label className="label" htmlFor="role">{t("role")}</label><select id="role" name="role" className="input"><option value="PLAYER">{t("rolePlayer")}</option><option value="OWNER">{t("roleOwner")}</option></select></div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" type="submit">{t("createAccount")}</button>
      </form>
    </div>
  );
}
