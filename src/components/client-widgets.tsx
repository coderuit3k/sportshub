"use client";
import { useEffect, useState } from "react";
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

export interface SlotDTO { startAt: string; endAt: string; startTime: string; price: number; available: boolean }
export interface FacilityDTO { id: string; name: string; slots: SlotDTO[] }

interface DisplaySlot { startAt: string; endAt: string; startTime: string; price: number; available: boolean }

export function BookingWidget({ facilities, venueName, initialDate }: { facilities: FacilityDTO[]; venueName: string; initialDate: string }) {
  // `date` is a plain calendar date (YYYY-MM-DD) in the business timezone
  // (Asia/Ho_Chi_Minh), supplied by the server as `initialDate`. The widget
  // NEVER builds instants from it — slot instants come from the server
  // (initial render or /api/availability), so the day the user clicks is
  // exactly the Saigon day that gets booked, whatever TZ the browser runs in.
  const [date, setDate] = useState(initialDate);
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [slot, setSlot] = useState<DisplaySlot | null>(null);
  const [duration, setDuration] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);

  const cacheKey = `${facilityId}|${date}`;
  const [slotCache, setSlotCache] = useState<Record<string, SlotDTO[]>>(() => {
    const init: Record<string, SlotDTO[]> = {};
    for (const f of facilities) init[`${f.id}|${initialDate}`] = f.slots;
    return init;
  });
  const hourly = slotCache[cacheKey];

  // Fetch the true slots (weekday, price rules, conflicts) for any
  // facility/date not rendered by the server.
  useEffect(() => {
    if (!facilityId || hourly || slotError) return;
    let cancelled = false;
    setLoadingSlots(true);
    fetch(`/api/availability?facilityId=${encodeURIComponent(facilityId)}&date=${encodeURIComponent(date)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("fetch failed");
        const j = (await r.json()) as { slots: SlotDTO[] };
        if (!cancelled) setSlotCache((c) => ({ ...c, [cacheKey]: j.slots }));
      })
      .catch(() => { if (!cancelled) setSlotError("Không tải được khung giờ — thử lại sau."); })
      .finally(() => { if (!cancelled) setLoadingSlots(false); });
    return () => { cancelled = true; };
  }, [facilityId, date, cacheKey, hourly, slotError]);

  // Aggregate consecutive hourly slots into bookable starts for `duration`:
  // price is the real per-hour sum (crossing the peak boundary prices each
  // hour by its own rule) and a start is available only if every covered
  // hour is free. The server still re-validates everything at booking time.
  const slots: DisplaySlot[] = [];
  if (hourly) {
    for (let i = 0; i + duration <= hourly.length; i++) {
      const group = hourly.slice(i, i + duration);
      slots.push({
        startAt: group[0].startAt,
        endAt: group[group.length - 1].endAt,
        startTime: group[0].startTime,
        price: group.reduce((sum, s) => sum + s.price, 0),
        available: group.every((s) => s.available),
      });
    }
  }
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
    setMsg(`Đặt thành công! Mã ${j.booking?.reference} — trạng thái ${j.booking?.status}. Xem ở "Lịch đặt của tôi".`);
  }
  return (
    <div className="card p-5">
      <h3 className="mb-4 text-lg font-bold">Đặt sân — {venueName}</h3>
      <p className="label">Bước 1: Chọn ngày</p>
      <input type="date" className="input mb-3" value={date} min={initialDate} onChange={(e) => { setDate(e.target.value); setSlot(null); setSlotError(null); }} />
      <p className="label">Bước 2: Chọn sân con & thời lượng</p>
      <div className="mb-3 flex gap-2">
        <select className="input" value={facilityId} onChange={(e) => { setFacilityId(e.target.value); setSlot(null); setSlotError(null); }} aria-label="Sân con">
          {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select className="input !w-32" value={duration} onChange={(e) => { setDuration(Number(e.target.value)); setSlot(null); }} aria-label="Thời lượng">
          {[1, 2, 3].map((h) => <option key={h} value={h}>{h} giờ</option>)}
        </select>
      </div>
      <p className="label">Bước 3: Chọn khung giờ (giá/giờ theo bảng giá sân)</p>
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {loadingSlots && <p className="col-span-full text-sm text-slate-500">Đang tải khung giờ...</p>}
        {!loadingSlots && slotError && <p className="col-span-full text-sm text-red-600">{slotError}</p>}
        {!loadingSlots && !slotError && slots.length === 0 && <p className="col-span-full text-sm text-slate-500">Sân đóng cửa ngày này.</p>}
        {slots.map((s) => (
          <button key={s.startAt} disabled={!s.available}
            onClick={() => setSlot(s)}
            className={`rounded-lg border px-2 py-2 text-sm ${!s.available ? "cursor-not-allowed bg-slate-100 text-slate-400" : slot?.startAt === s.startAt ? "border-primary bg-primary text-white" : "hover:border-primary"}`}>
            {s.startTime}<br /><span className="text-xs">{s.available ? formatVND(Math.round(s.price / duration)) : "Đã đặt"}</span>
          </button>
        ))}
      </div>
      {slot && (
        <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
          <p>Tổng giá {duration} giờ từ {slot.startTime}: các giờ được tính theo đúng bảng giá từng khung giờ.</p>
          <p className="text-base font-bold text-primary">Tổng (tính lại ở server): {formatVND(total)}</p>
          <p className="text-xs text-slate-500">Thanh toán qua VietQR/MoMo hoặc tại quầy.</p>
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

export function AdminUserControls({ userId, userEmail, isSelf }: { userId: string; userEmail: string; isSelf: boolean }) {
  const [showForm, setShowForm] = useState(false);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, string>) {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/admin/users/${userId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r.ok) { setMsg(j.error ?? "Thất bại"); return false; }
    return true;
  }

  return (
    <span className="inline-flex flex-col gap-2">
      <span className="inline-flex flex-wrap gap-2">
        <button className="btn-outline !px-3 !py-1.5 text-sm" disabled={busy} onClick={() => { setShowForm((s) => !s); setMsg(null); }}>
          Đặt mật khẩu mới
        </button>
        {!isSelf && (
          <button className="btn-outline !px-3 !py-1.5 text-sm !border-red-300 !text-red-600" disabled={busy}
            onClick={async () => {
              if (!window.confirm(`Khoá tài khoản ${userEmail}? Người dùng sẽ không đăng nhập được bằng bất kỳ mật khẩu nào đã biết. Bạn có thể mở khoá bằng cách đặt mật khẩu mới.`)) return;
              if (await post({ action: "lock" })) { setMsg("Đã khoá tài khoản."); window.location.reload(); }
            }}>
            Khoá tài khoản
          </button>
        )}
      </span>
      {showForm && (
        <span className="inline-flex flex-wrap items-center gap-2">
          <input type="password" className="input !w-56 !py-1.5 text-sm" placeholder="Mật khẩu mới (≥ 10 ký tự)" autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} aria-label={`Mật khẩu mới cho ${userEmail}`} />
          <button className="btn-primary !px-3 !py-1.5 text-sm" disabled={busy || password.length === 0}
            onClick={async () => {
              if (await post({ action: "set-password", password })) { setPassword(""); setShowForm(false); setMsg("Đã đặt mật khẩu mới."); }
            }}>
            Lưu mật khẩu
          </button>
        </span>
      )}
      {msg && <span className="text-sm text-slate-600" role="status">{msg}</span>}
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
