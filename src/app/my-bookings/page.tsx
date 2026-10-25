import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { BookingActionButtons } from "@/components/client-widgets";
import { refundPreview } from "@/services/bookings";
import { formatVND } from "@/lib/booking/logic";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { DATE_TIME_OPTIONS } from "@/i18n/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lịch đặt của tôi" };

const TABS = [
  { key: "upcoming", labelKey: "tabUpcoming", statuses: ["CONFIRMED"] },
  { key: "pending", labelKey: "tabPending", statuses: ["PENDING"] },
  { key: "completed", labelKey: "tabCompleted", statuses: ["COMPLETED"] },
  { key: "cancelled", labelKey: "tabCancelled", statuses: ["CANCELLED", "REJECTED", "EXPIRED"] },
] as const;

export default async function MyBookingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations("account");
  const locale = await getLocale();
  const format = await getFormatter();
  const sp = await searchParams;
  const counts = await Promise.all(TABS.map(async (tb) => ({ key: tb.key, count: await prisma.booking.count({ where: { userId: user.id, status: { in: [...tb.statuses] } } }) })));
  const active = TABS.find((tb) => tb.key === sp.tab) ?? TABS[0];
  const bookings = await prisma.booking.findMany({
    where: { userId: user.id, status: { in: [...active.statuses] } },
    include: { venue: true, facility: true, payments: true },
    orderBy: { startAt: "asc" },
  });
  const fmt = (d: Date) => format.dateTime(d, DATE_TIME_OPTIONS);
  const tierLabel = (tier: string) => {
    const key = `refundTier${tier}`;
    return t.has(key) ? t(key) : tier;
  };
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">{t("bookingsHeading")}</h1>
      <p className="mb-4 text-sm text-slate-500">{t("bookingsProfile", { name: user.name })}</p>
      <div className="mb-6 flex flex-wrap gap-2" role="tablist">
        {TABS.map((tb) => (
          <Link key={tb.key} href={`/my-bookings?tab=${tb.key}`} className={`rounded-full px-4 py-2 text-sm font-semibold ${active.key === tb.key ? "bg-primary text-white" : "bg-white border"}`}>
            {t(tb.labelKey)} ({counts.find((c) => c.key === tb.key)?.count ?? 0})
          </Link>
        ))}
      </div>
      {bookings.length === 0 ? <p className="card p-8 text-center text-slate-500">{t("bookingsEmpty")} <Link className="font-semibold text-primary" href="/venues">{t("findVenueNow")}</Link></p> : (
        <div className="space-y-4">
          {bookings.map((b) => {
            const preview = (b.status === "CONFIRMED" || b.status === "PENDING") ? refundPreview(b) : null;
            return (
              <article key={b.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-bold">{b.venue.name}</h2>
                    <p className="text-sm text-slate-500">{b.facility.name} — {fmt(b.startAt)} → {fmt(b.endAt)}</p>
                    <p className="text-sm">{t("bookingCode")}: <code className="font-semibold">#{b.reference}</code> — {t("bookingStatus")}: <strong>{b.status}</strong></p>
                    <p className="text-sm">{t("bookingTotal")}: <strong className="text-primary">{formatVND(b.totalPrice, locale)}</strong> — {b.payments.length === 0 ? t("noPayment") : b.payments.some((p) => p.amount < 0) ? t("refunded") : t("paid")}</p>
                    {preview && <p className="text-sm text-slate-500">{t("refundPreview", { amount: formatVND(preview.refundAmount, locale), tier: tierLabel(preview.tier) })}</p>}
                    <p className="mt-1 inline-block rounded bg-slate-100 px-2 py-1 text-xs font-semibold">{t("qrCheckin")}: {b.reference}</p>
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
