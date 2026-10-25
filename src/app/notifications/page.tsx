import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getFormatter, getTranslations } from "next-intl/server";
import { DATE_TIME_OPTIONS } from "@/i18n/format";
export const dynamic = "force-dynamic";
export const metadata = { title: "Thông báo" };
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations("account");
  const format = await getFormatter();
  const items = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  // Mark read on view (simple MVP behaviour, documented)
  await prisma.notification.updateMany({ where: { userId: user.id, isRead: false }, data: { isRead: true } });
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold">{t("notificationsHeading")}</h1>
      {items.length === 0 ? <p className="card p-8 text-center text-slate-500">{t("notificationsEmpty")}</p> : (
        <div className="space-y-3">{items.map((n) => (
          <article key={n.id} className={`card p-4 ${n.isRead ? "" : "border-l-4 border-l-secondary"}`}>
            <p className="font-bold">{n.title}</p><p className="text-sm">{n.body}</p>
            <p className="text-xs text-slate-400">{format.dateTime(n.createdAt, DATE_TIME_OPTIONS)} — {n.type}</p>
          </article>))}
        </div>
      )}
    </div>
  );
}
