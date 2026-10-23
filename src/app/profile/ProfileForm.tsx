"use client";
import { useState } from "react";
export default function ProfileForm({ initialName, initialDistrict, initialTime, sports, initialSportIds }: {
  initialName: string; initialDistrict: string; initialTime: string;
  sports: { id: string; name: string }[]; initialSportIds: string[];
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(initialSportIds);
  return (
    <form className="card space-y-4 p-6" onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const r = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: fd.get("name"), preferredDistrict: fd.get("district"), preferredTimeRange: fd.get("time"), sportIds: selected }) });
      setMsg(r.ok ? "Đã lưu hồ sơ." : "Lưu thất bại.");
      if (r.ok) window.location.reload();
    }}>
      <h2 className="font-bold">Cài đặt hồ sơ & sở thích thể thao</h2>
      <div><label className="label" htmlFor="name">Tên hiển thị</label><input id="name" name="name" defaultValue={initialName} className="input" /></div>
      <div className="grid gap-3 md:grid-cols-2">
        <div><label className="label" htmlFor="district">Khu vực ưa thích</label><input id="district" name="district" defaultValue={initialDistrict} className="input" placeholder="Thủ Đức" /></div>
        <div><label className="label" htmlFor="time">Khung giờ ưa thích</label><input id="time" name="time" defaultValue={initialTime} className="input" placeholder="17:00-21:00" /></div>
      </div>
      <fieldset><legend className="label">Môn yêu thích</legend>
        <div className="flex flex-wrap gap-2">{sports.map((s) => {
          const on = selected.includes(s.id);
          return <button type="button" key={s.id} aria-pressed={on} onClick={() => setSelected(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? "bg-primary text-white" : "bg-white"}`}>{s.name}</button>;
        })}</div>
      </fieldset>
      <button className="btn-primary" type="submit">Lưu thay đổi</button>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </form>
  );
}
