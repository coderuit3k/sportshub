"use client";
import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatVND } from "@/lib/booking/logic";

export function FavoriteButton({ venueId, initial }: { venueId: string; initial: boolean }) {
  const t = useTranslations("booking");
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
      <Heart className={`h-4 w-4 ${fav ? "fill-red-500 text-red-500" : ""}`} /> {fav ? t("favoriteSaved") : t("favoriteSave")}
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
  const t = useTranslations("booking");
  const locale = useLocale();
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
      .catch(() => { if (!cancelled) setSlotError(t("slotsError")); })
      .finally(() => { if (!cancelled) setLoadingSlots(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Known booking statuses get a localized label; anything unexpected
  // falls back to the raw value. API *error* strings stay server-side
  // Vietnamese (known i18n gap, see docs/architecture.md).
  const statusLabel = (status: string | undefined) => {
    if (!status) return "";
    const key = `status${status}`;
    return t.has(key) ? t(key) : status;
  };

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
    if (!r.ok) { setMsg(j.error ?? t("failed")); return; }
    setMsg(t("success", { reference: j.booking?.reference ?? "", status: statusLabel(j.booking?.status) }));
  }
  return (
    <div className="card p-5">
      <h3 className="mb-4 text-lg font-bold">{t("title", { venueName })}</h3>
      <p className="label">{t("step1")}</p>
      <input type="date" className="input mb-3" value={date} min={initialDate} onChange={(e) => { setDate(e.target.value); setSlot(null); setSlotError(null); }} />
      <p className="label">{t("step2")}</p>
      <div className="mb-3 flex gap-2">
        <select className="input" value={facilityId} onChange={(e) => { setFacilityId(e.target.value); setSlot(null); setSlotError(null); }} aria-label={t("facilityAria")}>
          {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select className="input !w-32" value={duration} onChange={(e) => { setDuration(Number(e.target.value)); setSlot(null); }} aria-label={t("durationAria")}>
          {[1, 2, 3].map((h) => <option key={h} value={h}>{t("hours", { count: h })}</option>)}
        </select>
      </div>
      <p className="label">{t("step3")}</p>
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {loadingSlots && <p className="col-span-full text-sm text-slate-500">{t("loadingSlots")}</p>}
        {!loadingSlots && slotError && <p className="col-span-full text-sm text-red-600">{slotError}</p>}
        {!loadingSlots && !slotError && slots.length === 0 && <p className="col-span-full text-sm text-slate-500">{t("closedThatDay")}</p>}
        {slots.map((s) => (
          <button key={s.startAt} disabled={!s.available}
            onClick={() => setSlot(s)}
            className={`rounded-lg border px-2 py-2 text-sm ${!s.available ? "cursor-not-allowed bg-slate-100 text-slate-400" : slot?.startAt === s.startAt ? "border-primary bg-primary text-white" : "hover:border-primary"}`}>
            {s.startTime}<br /><span className="text-xs">{s.available ? formatVND(Math.round(s.price / duration), locale) : t("slotBooked")}</span>
          </button>
        ))}
      </div>
      {slot && (
        <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
          <p>{t("summary", { duration, startTime: slot.startTime })}</p>
          <p className="text-base font-bold text-primary">{t("total", { total: formatVND(total, locale) })}</p>
          <p className="text-xs text-slate-500">{t("paymentNote")}</p>
        </div>
      )}
      <button className="btn-primary w-full" disabled={!slot || busy} onClick={confirm}>{busy ? t("processing") : t("confirm")}</button>
      {msg && <p role="status" className="mt-3 rounded-lg bg-secondary-light p-3 text-sm">{msg}</p>}
    </div>
  );
}

export function BookingActionButtons({ bookingId, actions }: { bookingId: string; actions: ("cancel" | "approve" | "reject" | "complete")[] }) {
  const t = useTranslations("booking");
  const [msg, setMsg] = useState<string | null>(null);
  const labels = { cancel: t("actionCancel"), approve: t("actionApprove"), reject: t("actionReject"), complete: t("actionComplete") };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {actions.map((a) => (
        <button key={a} className={a === "cancel" || a === "reject" ? "btn-outline !px-3 !py-1.5 text-sm !border-red-300 !text-red-600" : "btn-primary !px-3 !py-1.5 text-sm"}
          onClick={async () => {
            if (a === "cancel" && !window.confirm(t("cancelConfirm"))) return;
            const r = await fetch(`/api/bookings/${bookingId}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: a }) });
            const j = (await r.json()) as { error?: string };
            if (!r.ok) { setMsg(j.error ?? t("actionFailed")); return; }
            window.location.reload();
          }}>{labels[a]}</button>
      ))}
      {msg && <span className="text-sm text-red-600">{msg}</span>}
    </span>
  );
}

export function JoinButton({ sessionId, initialJoined, full }: { sessionId: string; initialJoined: boolean; full: boolean }) {
  const t = useTranslations("community");
  const [joined, setJoined] = useState(initialJoined);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button className={joined ? "btn-outline !px-3 !py-1.5 text-sm" : "btn-primary !px-3 !py-1.5 text-sm"} disabled={!joined && full}
        onClick={async () => {
          const r = await fetch(`/api/sessions/${sessionId}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: joined ? "leave" : "join" }) });
          if (r.status === 401) { window.location.href = "/login"; return; }
          const j = (await r.json()) as { error?: string; joined?: boolean };
          if (!r.ok) { setMsg(j.error ?? t("joinFailed")); return; }
          setJoined(Boolean(j.joined)); window.location.reload();
        }}>
        {joined ? t("leave") : full ? t("full") : t("join")}
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
