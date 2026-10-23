"use client";
import { useState } from "react";
export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-md">
      <form className="card space-y-4 p-6" onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }) });
        const j = (await r.json()) as { error?: string };
        if (!r.ok) { setError(j.error ?? "Đăng nhập thất bại"); return; }
        window.location.href = "/";
      }}>
        <h1 className="text-2xl font-bold">Đăng nhập</h1>
        <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" required className="input" autoComplete="email" /></div>
        <div><label className="label" htmlFor="password">Mật khẩu</label><input id="password" name="password" type="password" required className="input" autoComplete="current-password" /></div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" type="submit">Đăng nhập</button>
        <p className="text-sm text-slate-500">Tài khoản demo (chỉ dùng local): player@sportshub.local / owner@sportshub.local / admin@sportshub.local — mật khẩu <code>Password123!</code></p>
        <p className="text-sm">Chưa có tài khoản? <a className="font-semibold text-primary" href="/register">Đăng ký</a></p>
      </form>
    </div>
  );
}
