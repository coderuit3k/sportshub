"use client";
export default function LogoutButton() {
  return (
    <button
      className="rounded-lg border border-white/40 px-3 py-1.5 font-medium hover:bg-white/10"
      onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/"; }}
    >Đăng xuất</button>
  );
}
