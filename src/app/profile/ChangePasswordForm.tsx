"use client";
import { useState } from "react";

export default function ChangePasswordForm() {
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
        setMsg(r.ok ? "Đã đổi mật khẩu. Lần đăng nhập tới hãy dùng mật khẩu mới." : (data?.error ?? "Đổi mật khẩu thất bại."));
        if (r.ok) e.currentTarget.reset();
      }}
    >
      <h2 className="font-bold">Đổi mật khẩu</h2>
      <div>
        <label className="label" htmlFor="currentPassword">Mật khẩu hiện tại</label>
        <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className="input" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="newPassword">Mật khẩu mới</label>
          <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required className="input" />
          <p className="mt-1 text-xs text-slate-500">Tối thiểu 10 ký tự, khác mật khẩu hiện tại.</p>
        </div>
        <div>
          <label className="label" htmlFor="confirmPassword">Nhập lại mật khẩu mới</label>
          <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className="input" />
        </div>
      </div>
      <button className="btn-primary" type="submit" disabled={busy}>{busy ? "Đang xử lý…" : "Đổi mật khẩu"}</button>
      {msg && <p role="status" className={`text-sm ${ok ? "text-primary" : "text-red-600"}`}>{msg}</p>}
    </form>
  );
}
