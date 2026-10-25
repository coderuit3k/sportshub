"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

export default function ChangePasswordForm() {
  const t = useTranslations("account");
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card space-y-4 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const fd = new FormData(e.currentTarget);
        const r = await fetch("/api/profile/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword: fd.get("currentPassword"),
            newPassword: fd.get("newPassword"),
            confirmPassword: fd.get("confirmPassword"),
          }),
        });
        const data = (await r.json().catch(() => null)) as { error?: string } | null;
        setBusy(false);
        setOk(r.ok);
        // API error strings stay Vietnamese (known i18n gap); the success
        // message and the client-side fallback are localized.
        setMsg(r.ok ? t("passwordChanged") : (data?.error ?? t("passwordChangeFailed")));
        if (r.ok) e.currentTarget.reset();
      }}
    >
      <h2 className="font-bold">{t("passwordHeading")}</h2>
      <div>
        <label className="label" htmlFor="currentPassword">{t("currentPassword")}</label>
        <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className="input" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="newPassword">{t("newPassword")}</label>
          <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required className="input" />
          <p className="mt-1 text-xs text-slate-500">{t("passwordHintText")}</p>
        </div>
        <div>
          <label className="label" htmlFor="confirmPassword">{t("confirmPassword")}</label>
          <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className="input" />
        </div>
      </div>
      <button className="btn-primary" type="submit" disabled={busy}>{busy ? t("processing") : t("changePasswordSubmit")}</button>
      {msg && <p role="status" className={`text-sm ${ok ? "text-primary" : "text-red-600"}`}>{msg}</p>}
    </form>
  );
}
