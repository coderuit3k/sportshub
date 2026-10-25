"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { saigonDateTimeToInstant } from "@/lib/time/tz";
import { sportName } from "@/i18n/vocab";
export default function CreateSessionForm({ sports, venues }: { sports: { id: string; name: string; slug: string }[]; venues: { id: string; name: string }[] }) {
  const t = useTranslations("community.create");
  const tCommunity = useTranslations("community");
  const tSports = useTranslations("sports");
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn-secondary" onClick={() => setOpen(true)}>{t("open")}</button>;
  return (
    <form className="card space-y-3 p-5" onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const start = String(fd.get("startAt")); const dur = Number(fd.get("duration") ?? 2);
      // The datetime-local value is a wall-clock reading the user means in
      // Asia/Ho_Chi_Minh — anchor it there, not in the browser's local TZ
      // (`new Date(start)` would silently shift it on a non-Saigon browser).
      const [startDate, startTime] = start.split("T");
      const startInstant = saigonDateTimeToInstant(startDate, startTime ?? "00:00");
      const end = new Date(startInstant.getTime() + dur * 3600_000).toISOString();
      const r = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        title: fd.get("title"), sportId: fd.get("sportId"), venueId: fd.get("venueId") || undefined,
        startAt: startInstant.toISOString(), endAt: end, skillLevel: fd.get("skillLevel"),
        maxParticipants: Number(fd.get("maxParticipants")), costPerPerson: Number(fd.get("costPerPerson") ?? 0),
        description: fd.get("description") || undefined,
      })});
      const j = (await r.json()) as { error?: string };
      if (!r.ok) { setMsg(j.error ?? t("failed")); return; }
      window.location.reload();
    }}>
      <h2 className="font-bold">{t("heading")}</h2>
      <div><label className="label" htmlFor="title">{t("title")}</label><input id="title" name="title" required minLength={5} className="input" placeholder={t("titlePlaceholder")} /></div>
      <div className="grid gap-3 md:grid-cols-3">
        <div><label className="label" htmlFor="sportId">{t("sport")}</label><select id="sportId" name="sportId" className="input">{sports.map((s) => <option key={s.id} value={s.id}>{sportName((k) => tSports(k), s.slug, s.name)}</option>)}</select></div>
        <div><label className="label" htmlFor="venueId">{t("venue")}</label><select id="venueId" name="venueId" className="input"><option value="">{t("venueTbd")}</option>{venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <div><label className="label" htmlFor="skillLevel">{t("skill")}</label><select id="skillLevel" name="skillLevel" className="input"><option value="ALL">{tCommunity("skillALL")}</option><option value="BEGINNER">{tCommunity("skillBEGINNER")}</option><option value="INTERMEDIATE">{tCommunity("skillINTERMEDIATE")}</option><option value="ADVANCED">{tCommunity("skillADVANCED")}</option></select></div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2"><label className="label" htmlFor="startAt">{t("startAt")}</label><input id="startAt" name="startAt" type="datetime-local" required className="input" /></div>
        <div><label className="label" htmlFor="duration">{t("hours")}</label><input id="duration" name="duration" type="number" defaultValue={2} min={1} max={4} className="input" /></div>
        <div><label className="label" htmlFor="maxParticipants">{t("maxParticipants")}</label><input id="maxParticipants" name="maxParticipants" type="number" defaultValue={6} min={2} max={50} required className="input" /></div>
      </div>
      <div><label className="label" htmlFor="costPerPerson">{t("costPerPerson")}</label><input id="costPerPerson" name="costPerPerson" type="number" defaultValue={50000} min={0} step={5000} className="input" /></div>
      <div><label className="label" htmlFor="description">{t("description")}</label><textarea id="description" name="description" className="input" rows={2} /></div>
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      <div className="flex gap-2"><button className="btn-primary" type="submit">{t("submit")}</button><button type="button" className="btn-outline" onClick={() => setOpen(false)}>{t("close")}</button></div>
    </form>
  );
}
