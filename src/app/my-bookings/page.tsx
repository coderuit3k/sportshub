import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { BookingActionButtons } from "@/components/client-widgets";
import { refundPreview } from "@/services/bookings";
import { formatVND } from "@/lib/booking/logic";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lịch đặt của tôi" };

const TABS = [
  { key: "upcoming", label: "Sắp diễn ra", statuses: ["CONFIRMED"] },
  { key: "pending", label: "Chờ duyệt", statuses: ["PENDING"] },
  { key: "completed", label: "Đã hoàn thành", statuses: ["COMPLETED"] },
  { key: "cancelled", label: "Đã hủy", statuses: ["CANCELLED", "REJECTED", "EXPIRED"] },
] as const;

export default async function MyBookingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const counts = await Promise.all(TABS.map(async (t) => ({ key: t.key, count: await prisma.booking.count({ where: { userId: user.id, status: { in: [...t.statuses] } } }) })));
  const active = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const bookings = await prisma.booking.findMany({
    where: { userId: user.id, status: { in: [...active.statuses] } },
    include: { venue: true, facility: true, payments: true },
    orderBy: { startAt: "asc" },
  });
  const fmt = (d: Date) => d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Lịch đặt của tôi</h1>
      <p className="mb-4 text-sm text-slate-500">Hồ sơ: {user.name}.</p>
      <div className="mb-6 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <Link key={t.key} href={`/my-bookings?tab=${t.key}`} className={`rounded-full px-4 py-2 text-sm font-semibold ${active.key === t.key ? "bg-primary text-white" : "bg-white border"}`}>
            {t.label} ({counts.find((c) => c.key === t.key)?.count ?? 0})
          </Link>
        ))}
      </div>
      {bookings.length === 0 ? <p className="card p-8 text-center text-slate-500">Chưa có đặt sân ở mục này. <Link className="font-semibold text-primary" href="/venues">Tìm sân ngay →</Link></p> : (
        <div className="space-y-4">
          {bookings.map((b) => {
            const preview = (b.status === "CONFIRMED" || b.status === "PENDING") ? refundPreview(b) : null;
            return (
              <article key={b.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-bold">{b.venue.name}</h2>
                    <p className="text-sm text-slate-500">{b.facility.name} — {fmt(b.startAt)} → {fmt(b.endAt)}</p>
                    <p className="text-sm">Mã: <code className="font-semibold">#{b.reference}</code> — Trạng thái: <strong>{b.status}</strong></p>
                    <p className="text-sm">Tổng: <strong className="text-primary">{formatVND(b.totalPrice)}</strong> — {b.payments.length === 0 ? "Chưa có thanh toán" : b.payments.some((p) => p.amount < 0) ? "Đã hoàn tiền" : "Đã thanh toán"}</p>
                    {preview && <p className="text-sm text-slate-500">Nếu hủy bây giờ: hoàn {formatVND(preview.refundAmount)} (mức {preview.tier}).</p>}
                    <p className="mt-1 inline-block rounded bg-slate-100 px-2 py-1 text-xs font-semibold">QR check-in: {b.reference}</p>
                  </div>
                  {(b.status === "CONFIRMED" || b.status === "PENDING") && <BookingActionButtons bookingId={b.id} actions={["cancel"]} />}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
