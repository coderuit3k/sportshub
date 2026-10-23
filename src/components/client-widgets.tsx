"use client";
import { useState } from "react";
import { Heart } from "lucide-react";
import { formatVND } from "@/lib/booking/logic";

export function FavoriteButton({ venueId, initial }: { venueId: string; initial: boolean }) {
  const [fav, setFav] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <button disabled={busy} className="btn-outline !py-2 text-sm"
      onClick={async () => {
        setBusy(true);
        const r = await fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ venueId }) });
        if (r.status === 401) { window.location.href = "/login"; return; }
        const j = (await r.json()) as { favorite: boolean };
        setFav(j.favorite); setBusy(false);
      }}>
      <Heart className={`h-4 w-4 ${fav ? "fill-red-500 text-red-500" : ""}`} /> {fav ? "Đã lưu yêu thích" : "Lưu yêu thích"}
    </button>
  );
}

export interface SlotDTO { startAt: string; endAt: string; price: number; available: boolean }
export interface FacilityDTO { id: string; name: string; slots: SlotDTO[] }

export function BookingWidget({ facilities, venueName }: { facilities: FacilityDTO[]; venueName: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [slot, setSlot] = useState<SlotDTO | null>(null);
  const [duration, setDuration] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Slots are precomputed server-side for the venue's "today" view; for other dates we
  // reuse the same daily template and shift by date (availability re-validated on server at booking).
  const facility = facilities.find((f) => f.id === facilityId);
  const slots = (facility?.slots ?? []).map((s) => {
    const st = new Date(`${date}T${s.startAt.slice(11, 19)}`);
    const en = new Date(st.getTime() + duration * 3600_000);
    return { ...s, startAt: st.toISOString(), endAt: en.toISOString(), price: s.price * duration };
  });
  const total = slot ? slot.price : 0;

  async function confirm() {
    if (!slot) return;
    setBusy(true); setMsg(null);
    const idempotencyKey = `web-${facilityId}-${slot.startAt}-${duration}`;
    const r = await fetch("/api/bookings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facilityId, startAt: slot.startAt, endAt: slot.endAt, idempotencyKey }),
    });
    const j = (await r.json()) as { error?: string; booking?: { reference: string; status: string } };
    setBusy(false);
    if (!r.ok) { setMsg(j.error ?? "Đặt sân thất bại"); return; }
    setMsg(`Đặt thành công! Mã ${j.booking?.reference} — trạng thái ${j.booking?.status}. Thanh toán MÔ PHỎNG. Xem ở "Lịch đặt của tôi".`);
  }
  return (
    <div className="card p-5">
      <h3 className="mb-4 text-lg font-bold">Đặt sân — {venueName}</h3>
      <p className="label">Bước 1: Chọn ngày</p>
      <input type="date" className="input mb-3" value={date} min={today} onChange={(e) => { setDate(e.target.value); setSlot(null); }} />
      <p className="label">Bước 2: Chọn sân con & thời lượng</p>
      <div className="mb-3 flex gap-2">
        <select className="input" value={facilityId} onChange={(e) => { setFacilityId(e.target.value); setSlot(null); }} aria-label="Sân con">
          {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select className="input !w-32" value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Thời lượng">
          {[1, 2, 3].map((h) => <option key={h} value={h}>{h} giờ</option>)}
        </select>
      </div>
      <p className="label">Bước 3: Chọn khung giờ (giá/giờ theo bảng giá sân)</p>
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {slots.length === 0 && <p className="col-span-full text-sm text-slate-500">Sân đóng cửa ngày này.</p>}
        {slots.map((s) => (
          <button key={s.startAt} disabled={!s.available}
            onClick={() => setSlot(s)}
            className={`rounded-lg border px-2 py-2 text-sm ${!s.available ? "cursor-not-allowed bg-slate-100 text-slate-400" : slot?.startAt === s.startAt ? "border-primary bg-primary text-white" : "hover:border-primary"}`}>
            {s.startAt.slice(11, 16)}<br /><span className="text-xs">{s.available ? formatVND(s.price / duration) : "Đã đặt"}</span>
          </button>
        ))}
      </div>
      {slot && (
        <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
          <p>Chi tiết giá: {duration} giờ × từ {formatVND(slot.price / duration)}/giờ</p>
          <p className="text-base font-bold text-primary">Tổng (tính lại ở server): {formatVND(total)}</p>
          <p className="text-xs text-slate-500">Thanh toán MÔ PHỎNG qua VietQR/MoMo/tại quầy — chưa thu tiền thật.</p>
        </div>
      )}
      <button className="btn-primary w-full" disabled={!slot || busy} onClick={confirm}>{busy ? "Đang xử lý..." : "Xác nhận đặt sân"}</button>
      {msg && <p role="status" className="mt-3 rounded-lg bg-secondary-light p-3 text-sm">{msg}</p>}
    </div>
  );
}

export function BookingActionButtons({ bookingId, actions }: { bookingId: string; actions: ("cancel" | "approve" | "reject" | "complete")[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const labels = { cancel: "Hủy đặt", approve: "Duyệt", reject: "Từ chối", complete: "Đánh dấu hoàn thành" };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {actions.map((a) => (
        <button key={a} className={a === "cancel" || a === "reject" ? "btn-outline !px-3 !py-1.5 text-sm !border-red-300 !text-red-600" : "btn-primary !px-3 !py-1.5 text-sm"}
          onClick={async () => {
            if (a === "cancel" && !window.confirm("Hủy đặt sân này? Mức hoàn sẽ tính theo chính sách đã lưu.")) return;
            const r = await fetch(`/api/bookings/${bookingId}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: a }) });
            const j = (await r.json()) as { error?: string };
            if (!r.ok) { setMsg(j.error ?? "Thất bại"); return; }
            window.location.reload();
          }}>{labels[a]}</button>
      ))}
      {msg && <span className="text-sm text-red-600">{msg}</span>}
    </span>
  );
}

export function JoinButton({ sessionId, initialJoined, full }: { sessionId: string; initialJoined: boolean; full: boolean }) {
  const [joined, setJoined] = useState(initialJoined);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button className={joined ? "btn-outline !px-3 !py-1.5 text-sm" : "btn-primary !px-3 !py-1.5 text-sm"} disabled={!joined && full}
        onClick={async () => {
          const r = await fetch(`/api/sessions/${sessionId}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: joined ? "leave" : "join" }) });
          if (r.status === 401) { window.location.href = "/login"; return; }
          const j = (await r.json()) as { error?: string; joined?: boolean };
          if (!r.ok) { setMsg(j.error ?? "Thất bại"); return; }
          setJoined(Boolean(j.joined)); window.location.reload();
        }}>
        {joined ? "Rời kèo" : full ? "Đã đầy" : "Tham gia"}
      </button>
      {msg && <span className="text-sm text-red-600">{msg}</span>}
    </span>
  );
}

export function AdminVenueButtons({ venueId }: { venueId: string }) {
  return (
    <span className="inline-flex gap-2">
      {(["approve", "reject"] as const).map((a) => (
        <button key={a} className={a === "approve" ? "btn-primary !px-3 !py-1.5 text-sm" : "btn-outline !px-3 !py-1.5 text-sm !border-red-300 !text-red-600"}
          onClick={async () => {
            await fetch(`/api/admin/venues/${venueId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: a }) });
            window.location.reload();
          }}>{a === "approve" ? "Duyệt sân" : "Từ chối"}</button>
      ))}
    </span>
  );
}
