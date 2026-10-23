"use client";
import { useState } from "react";
export default function RegisterPage() {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-md">
      <form className="card space-y-4 p-6" onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const r = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: fd.get("name"), email: fd.get("email"), password: fd.get("password"), role: fd.get("role") }) });
        const j = (await r.json()) as { error?: string };
        if (!r.ok) { setError(j.error ?? "Đăng ký thất bại"); return; }
        window.location.href = "/";
      }}>
        <h1 className="text-2xl font-bold">Đăng ký SportsHub</h1>
        <div><label className="label" htmlFor="name">Họ tên</label><input id="name" name="name" required className="input" /></div>
        <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" required className="input" autoComplete="email" /></div>
        <div><label className="label" htmlFor="password">Mật khẩu (≥ 8 ký tự)</label><input id="password" name="password" type="password" required minLength={8} className="input" autoComplete="new-password" /></div>
        <div><label className="label" htmlFor="role">Vai trò</label><select id="role" name="role" className="input"><option value="PLAYER">Người chơi</option><option value="OWNER">Chủ sân</option></select></div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" type="submit">Tạo tài khoản</button>
      </form>
    </div>
  );
}
