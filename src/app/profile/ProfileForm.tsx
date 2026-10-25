"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { sportName } from "@/i18n/vocab";
export default function ProfileForm({ initialName, initialDistrict, initialTime, sports, initialSportIds }: {
  initialName: string; initialDistrict: string; initialTime: string;
  sports: { id: string; name: string; slug: string }[]; initialSportIds: string[];
}) {
  const t = useTranslations("account");
  const tSports = useTranslations("sports");
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(initialSportIds);
  return (
    <form className="card space-y-4 p-6" onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const r = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: fd.get("name"), preferredDistrict: fd.get("district"), preferredTimeRange: fd.get("time"), sportIds: selected }) });
      setMsg(r.ok ? t("profileSaved") : t("profileSaveFailed"));
      if (r.ok) window.location.reload();
    }}>
      <h2 className="font-bold">{t("profileFormHeading")}</h2>
      <div><label className="label" htmlFor="name">{t("displayName")}</label><input id="name" name="name" defaultValue={initialName} className="input" /></div>
      <div className="grid gap-3 md:grid-cols-2">
        <div><label className="label" htmlFor="district">{t("preferredDistrict")}</label><input id="district" name="district" defaultValue={initialDistrict} className="input" placeholder={t("preferredDistrictPlaceholder")} /></div>
        <div><label className="label" htmlFor="time">{t("preferredTime")}</label><input id="time" name="time" defaultValue={initialTime} className="input" placeholder="17:00-21:00" /></div>
      </div>
      <fieldset><legend className="label">{t("favoriteSports")}</legend>
        <div className="flex flex-wrap gap-2">{sports.map((s) => {
          const on = selected.includes(s.id);
          return <button type="button" key={s.id} aria-pressed={on} onClick={() => setSelected(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? "bg-primary text-white" : "bg-white"}`}>{sportName((k) => tSports(k), s.slug, s.name)}</button>;
        })}</div>
      </fieldset>
      <button className="btn-primary" type="submit">{t("saveChanges")}</button>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </form>
  );
}
