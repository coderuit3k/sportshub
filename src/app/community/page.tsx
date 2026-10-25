import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { JoinButton } from "@/components/client-widgets";
import SportIcon from "@/components/SportIcon";
import { formatVND } from "@/lib/booking/logic";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { sportName } from "@/i18n/vocab";
import { DATE_TIME_OPTIONS } from "@/i18n/format";
import CreateSessionForm from "./CreateSessionForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Play Together — Cộng đồng" };

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ sport?: string; skill?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const t = await getTranslations("community");
  const tSports = await getTranslations("sports");
  const locale = await getLocale();
  const format = await getFormatter();
  const sportLabel = (slug: string, name: string) => sportName((k) => tSports(k), slug, name);
  const skillLabel = (level: string) => {
    const key = `skill${level}`;
    return t.has(key) ? t(key) : level;
  };
  const sports = await prisma.sport.findMany();
  const sessions = await prisma.sportsSession.findMany({
    where: {
      status: { in: ["OPEN", "FULL"] },
      ...(sp.sport ? { sport: { slug: sp.sport } } : {}),
      ...(sp.skill ? { skillLevel: sp.skill } : {}),
    },
    include: { sport: true, venue: true, organizer: true, participants: { where: { status: "JOINED" } } },
    orderBy: { startAt: "asc" },
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("heading")}</h1>
        <p className="text-sm text-slate-500">{t("intro")}</p>
      </div>
      <form method="get" className="flex flex-wrap gap-2" aria-label={t("filterAria")}>
        <select name="sport" className="input !w-auto" defaultValue={sp.sport ?? ""} aria-label={t("sportAria")}><option value="">{t("allSports")}</option>{sports.map((s) => <option key={s.id} value={s.slug}>{sportLabel(s.slug, s.name)}</option>)}</select>
        <select name="skill" className="input !w-auto" defaultValue={sp.skill ?? ""} aria-label={t("skillAria")}><option value="">{t("allSkills")}</option><option value="BEGINNER">{t("skillBEGINNER")}</option><option value="INTERMEDIATE">{t("skillINTERMEDIATE")}</option><option value="ADVANCED">{t("skillADVANCED")}</option><option value="ALL">{t("skillALL")}</option></select>
        <button className="btn-primary" type="submit">{t("filter")}</button>
        <Link href="/community" className="btn-outline">{t("clearFilter")}</Link>
      </form>
      {user ? <CreateSessionForm sports={sports.map((s) => ({ id: s.id, name: s.name, slug: s.slug }))} venues={(await prisma.venue.findMany({ where: { status: "APPROVED" }, select: { id: true, name: true } })).map((v) => ({ id: v.id, name: v.name }))} />
        : <p className="card p-4 text-sm">{t.rich("loginPrompt", { link: (chunks) => <Link className="font-semibold text-primary" href="/login">{chunks}</Link> })}</p>}
      {sessions.length === 0 ? <p className="card p-8 text-center text-slate-500">{t("empty")}</p> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sessions.map((s) => {
            const joined = user ? s.participants.some((p) => p.userId === user.id) : false;
            const full = s.participants.length >= s.maxParticipants || s.status === "FULL";
            return (
              <article key={s.id} className="card flex flex-col p-5">
                <div className="mb-2 flex gap-1"><span className="chip"><SportIcon slug={s.sport.slug} />{sportLabel(s.sport.slug, s.sport.name)}</span><span className="chip">{skillLabel(s.skillLevel)}</span>{full && <span className="chip !bg-red-100 !text-red-700">{t("full")}</span>}</div>
                <h2 className="font-bold">{s.title}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("organizer", { name: s.organizer.name })}</p>
                <p className="text-sm">{s.venue?.name ?? t("flexibleVenue")} — {format.dateTime(s.startAt, DATE_TIME_OPTIONS)}</p>
                <p className="text-sm">{t("estimatedCost", { price: formatVND(s.costPerPerson, locale) })}</p>
                <p className="text-sm font-medium">{t("participants", { joined: s.participants.length, max: s.maxParticipants })}</p>
                {s.description && <p className="mt-1 text-sm text-slate-600">{s.description}</p>}
                <div className="mt-auto pt-3">{user ? <JoinButton sessionId={s.id} initialJoined={joined} full={full} /> : <Link className="btn-primary !px-3 !py-1.5 text-sm" href="/login">{t("loginToJoin")}</Link>}</div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
