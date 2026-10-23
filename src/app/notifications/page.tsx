import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const metadata = { title: "Thông báo" };
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const items = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  // Mark read on view (simple MVP behaviour, documented)
  await prisma.notification.updateMany({ where: { userId: user.id, isRead: false }, data: { isRead: true } });
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold">Thông báo</h1>
      {items.length === 0 ? <p className="card p-8 text-center text-slate-500">Chưa có thông báo.</p> : (
        <div className="space-y-3">{items.map((n) => (
          <article key={n.id} className={`card p-4 ${n.isRead ? "" : "border-l-4 border-l-secondary"}`}>
            <p className="font-bold">{n.title}</p><p className="text-sm">{n.body}</p>
            <p className="text-xs text-slate-400">{n.createdAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} — {n.type}</p>
          </article>))}
        </div>
      )}
    </div>
  );
}
