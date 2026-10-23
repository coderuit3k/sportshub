import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { AdminUserControls, AdminVenueButtons } from "@/components/client-widgets";
import { formatVND } from "@/lib/booking/logic";
export const dynamic = "force-dynamic";
export const metadata = { title: "Super Admin" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");
  const [venuesCount, usersCount, bookings, pendingVenues, users, logs, sessionsCount] = await Promise.all([
    prisma.venue.count({ where: { status: "APPROVED" } }),
    prisma.user.count(),
    prisma.booking.findMany(),
    prisma.venue.findMany({ where: { status: "PENDING_APPROVAL" }, include: { owner: true } }),
    prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { actor: true } }),
    prisma.sportsSession.count(),
  ]);
  const gmv = bookings.filter((b) => ["CONFIRMED", "COMPLETED"].includes(b.status)).reduce((s, b) => s + b.totalPrice, 0);
  const escrow = Math.round(gmv * 0.03);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Super Admin — giám sát nền tảng</h1>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="card p-4"><p className="text-sm text-slate-500">GMV (giá trị đặt xác nhận, mô phỏng)</p><p className="text-2xl font-extrabold text-primary">{formatVND(gmv)}</p></div>
        <div className="card p-4"><p className="text-sm text-slate-500">Phí nền tảng 3% (escrow mô phỏng)</p><p className="text-2xl font-extrabold">{formatVND(escrow)}</p></div>
        <div className="card p-4"><p className="text-sm text-slate-500">Cụm sân đối tác / người dùng</p><p className="text-2xl font-extrabold">{venuesCount} / {usersCount}</p></div>
        <div className="card p-4"><p className="text-sm text-slate-500">KYC / duyệt sân chờ — kèo cộng đồng</p><p className="text-2xl font-extrabold text-accent">{pendingVenues.length} chờ — {sessionsCount} kèo</p></div>
      </div>
      <section className="card p-5">
        <h2 className="mb-3 font-bold">Hàng đợi duyệt sân ({pendingVenues.length})</h2>
        {pendingVenues.length === 0 ? <p className="text-slate-500">Không có sân chờ duyệt.</p> : pendingVenues.map((v) => (
          <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-3 last:border-0">
            <div><p className="font-semibold">{v.name}</p><p className="text-sm text-slate-500">{v.district} — Chủ sân: {v.owner.name} ({v.owner.email})</p></div>
            <AdminVenueButtons venueId={v.id} />
          </div>
        ))}
      </section>
      <section className="card p-5">
        <h2 className="mb-3 font-bold">Người dùng</h2>
        <table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th className="py-1">Tên</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>{users.map((u) => <tr key={u.id} className="border-t"><td className="py-2">{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.status}</td><td className="py-2"><AdminUserControls userId={u.id} userEmail={u.email} isSelf={u.id === user.id} /></td></tr>)}</tbody></table>
        <p className="mt-3 text-sm text-slate-500">Đặt mật khẩu mới: dùng để xoay vòng (rotate) các tài khoản demo sau khi deploy production. Khoá tài khoản: thay mật khẩu bằng giá trị ngẫu nhiên không ai biết — mở khoá bằng cách đặt mật khẩu mới. Mọi thao tác đều ghi Audit Log.</p>
      </section>
      <section className="card p-5">
        <h2 className="mb-3 font-bold">Audit Log (thời gian thực từ DB)</h2>
        {logs.length === 0 ? <p className="text-slate-500">Chưa có log.</p> : logs.map((l) => (
          <p key={l.id} className="border-b py-2 text-sm last:border-0"><strong>{l.action}</strong> — {l.entity}{l.entityId ? `/${l.entityId}` : ""} — bởi {l.actor?.name ?? "hệ thống"} — {l.createdAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}{l.details ? ` — ${l.details}` : ""}</p>
        ))}
      </section>
    </div>
  );
}
