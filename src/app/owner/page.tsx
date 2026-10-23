import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { BookingActionButtons } from "@/components/client-widgets";
import { formatVND } from "@/lib/booking/logic";
export const dynamic = "force-dynamic";
export const metadata = { title: "Kênh chủ sân" };

export default async function OwnerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "OWNER" && user.role !== "ADMIN") redirect("/");
  const venues = await prisma.venue.findMany({ where: { ownerId: user.id }, include: { facilities: true, bookings: true } });
  const venueIds = venues.map((v) => v.id);
  const bookings = await prisma.booking.findMany({
    where: { venueId: { in: venueIds } },
    include: { venue: true, facility: true, user: true },
    orderBy: { startAt: "asc" },
  });
  const revenue = bookings.filter((b) => ["CONFIRMED", "COMPLETED"].includes(b.status)).reduce((s, b) => s + b.totalPrice, 0);
  const pending = bookings.filter((b) => b.status === "PENDING");
  const totalSlotsApprox = venues.reduce((s, v) => s + v.facilities.length * 16 * 30, 0);
  const utilization = totalSlotsApprox > 0 ? Math.round((bookings.filter((b) => b.status !== "CANCELLED").length / totalSlotsApprox) * 1000) / 10 : 0;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Kênh chủ sân — CƠ SỞ PRO-ACTIVE</h1>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="card p-4"><p className="text-sm text-slate-500">Doanh thu (từ các đặt sân đã xác nhận)</p><p className="text-2xl font-extrabold text-primary">{formatVND(revenue)}</p></div>
        <div className="card p-4"><p className="text-sm text-slate-500">Tổng lượt đặt</p><p className="text-2xl font-extrabold">{bookings.length}</p></div>
        <div className="card p-4"><p className="text-sm text-slate-500">Chờ duyệt</p><p className="text-2xl font-extrabold text-accent">{pending.length}</p></div>
        <div className="card p-4"><p className="text-sm text-slate-500">Tỷ lệ lấp đầy ước tính</p><p className="text-2xl font-extrabold">{utilization}%</p></div>
      </div>
      <section className="card p-5">
        <h2 className="mb-3 font-bold">Cơ sở của tôi</h2>
        {venues.length === 0 ? <p className="text-slate-500">Chưa có cơ sở nào gắn với tài khoản này.</p> : venues.map((v) => (
          <div key={v.id} className="border-b py-3 last:border-0">
            <p className="font-bold">{v.name}</p>
            <p className="text-sm text-slate-500">{v.district} — Trạng thái: {v.status} — {v.facilities.length} sân con — {v.bookings.length} đặt sân — Giá/hủy: hoàn 100% trước {v.cancelFullBeforeHours}h, phí {v.cancelPartialFeePercent}% trước {v.cancelPartialBeforeHours}h</p>
          </div>
        ))}
      </section>
      <section className="card p-5">
        <h2 className="mb-3 font-bold">Lịch đặt & hàng đợi phê duyệt (dạng danh sách theo ngày)</h2>
        {bookings.length === 0 ? <p className="text-slate-500">Chưa có đặt sân.</p> : bookings.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-3 last:border-0">
            <div>
              <p className="font-semibold">#{b.reference} — {b.venue.name} / {b.facility.name}</p>
              <p className="text-sm text-slate-500">{b.user.name} — {b.startAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} → {b.endAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} — {formatVND(b.totalPrice)} — <strong>{b.status}</strong></p>
            </div>
            <span className="flex gap-2">
              {b.status === "PENDING" && <BookingActionButtons bookingId={b.id} actions={["approve", "reject"]} />}
              {b.status === "CONFIRMED" && <BookingActionButtons bookingId={b.id} actions={["complete", "cancel"]} />}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
