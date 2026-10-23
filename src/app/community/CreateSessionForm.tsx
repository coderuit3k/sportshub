"use client";
import { useState } from "react";
export default function CreateSessionForm({ sports, venues }: { sports: { id: string; name: string }[]; venues: { id: string; name: string }[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn-secondary" onClick={() => setOpen(true)}>+ Tạo kèo mới</button>;
  return (
    <form className="card space-y-3 p-5" onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const start = String(fd.get("startAt")); const dur = Number(fd.get("duration") ?? 2);
      const end = new Date(new Date(start).getTime() + dur * 3600_000).toISOString();
      const r = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        title: fd.get("title"), sportId: fd.get("sportId"), venueId: fd.get("venueId") || undefined,
        startAt: new Date(start).toISOString(), endAt: end, skillLevel: fd.get("skillLevel"),
        maxParticipants: Number(fd.get("maxParticipants")), costPerPerson: Number(fd.get("costPerPerson") ?? 0),
        description: fd.get("description") || undefined,
      })});
      const j = (await r.json()) as { error?: string };
      if (!r.ok) { setMsg(j.error ?? "Tạo kèo thất bại"); return; }
      window.location.reload();
    }}>
      <h2 className="font-bold">Tạo kèo cộng đồng</h2>
      <div><label className="label" htmlFor="title">Tiêu đề kèo</label><input id="title" name="title" required minLength={5} className="input" placeholder="VD: Kèo cầu lông tối thứ 7 — cần 2 người" /></div>
      <div className="grid gap-3 md:grid-cols-3">
        <div><label className="label" htmlFor="sportId">Môn</label><select id="sportId" name="sportId" className="input">{sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="venueId">Sân (tùy chọn)</label><select id="venueId" name="venueId" className="input"><option value="">Chưa chốt</option>{venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <div><label className="label" htmlFor="skillLevel">Trình độ</label><select id="skillLevel" name="skillLevel" className="input"><option value="ALL">Tất cả</option><option value="BEGINNER">Người mới</option><option value="INTERMEDIATE">Trung bình</option><option value="ADVANCED">Nâng cao</option></select></div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2"><label className="label" htmlFor="startAt">Bắt đầu</label><input id="startAt" name="startAt" type="datetime-local" required className="input" /></div>
        <div><label className="label" htmlFor="duration">Số giờ</label><input id="duration" name="duration" type="number" defaultValue={2} min={1} max={4} className="input" /></div>
        <div><label className="label" htmlFor="maxParticipants">Số người tối đa</label><input id="maxParticipants" name="maxParticipants" type="number" defaultValue={6} min={2} max={50} required className="input" /></div>
      </div>
      <div><label className="label" htmlFor="costPerPerson">Chi phí dự kiến / người (đ)</label><input id="costPerPerson" name="costPerPerson" type="number" defaultValue={50000} min={0} step={5000} className="input" /></div>
      <div><label className="label" htmlFor="description">Mô tả</label><textarea id="description" name="description" className="input" rows={2} /></div>
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
      <div className="flex gap-2"><button className="btn-primary" type="submit">Tạo kèo</button><button type="button" className="btn-outline" onClick={() => setOpen(false)}>Đóng</button></div>
    </form>
  );
}
