import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { JoinButton } from "@/components/client-widgets";
import SportIcon from "@/components/SportIcon";
import { formatVND } from "@/lib/booking/logic";
import CreateSessionForm from "./CreateSessionForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Play Together — Cộng đồng" };

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ sport?: string; skill?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
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
        <h1 className="text-2xl font-bold">Cộng đồng — Play Together</h1>
        <p className="text-sm text-slate-500">Kèo cộng đồng khác với đặt sân đã xác nhận: tham gia kèo không tự động giữ sân, trừ khi kèo được gắn với một đặt sân đã hoàn tất.</p>
      </div>
      <form method="get" className="flex flex-wrap gap-2" aria-label="Lọc kèo">
        <select name="sport" className="input !w-auto" defaultValue={sp.sport ?? ""} aria-label="Môn"><option value="">Tất cả môn</option>{sports.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}</select>
        <select name="skill" className="input !w-auto" defaultValue={sp.skill ?? ""} aria-label="Trình độ"><option value="">Mọi trình độ</option><option value="BEGINNER">Người mới</option><option value="INTERMEDIATE">Trung bình</option><option value="ADVANCED">Nâng cao</option><option value="ALL">Tất cả</option></select>
        <button className="btn-primary" type="submit">Lọc</button>
        <Link href="/community" className="btn-outline">Xóa lọc</Link>
      </form>
      {user ? <CreateSessionForm sports={sports.map((s) => ({ id: s.id, name: s.name }))} venues={(await prisma.venue.findMany({ where: { status: "APPROVED" }, select: { id: true, name: true } })).map((v) => ({ id: v.id, name: v.name }))} />
        : <p className="card p-4 text-sm"><Link className="font-semibold text-primary" href="/login">Đăng nhập</Link> để tạo kèo và tham gia.</p>}
      {sessions.length === 0 ? <p className="card p-8 text-center text-slate-500">Chưa có kèo phù hợp.</p> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sessions.map((s) => {
            const joined = user ? s.participants.some((p) => p.userId === user.id) : false;
            const full = s.participants.length >= s.maxParticipants || s.status === "FULL";
            return (
              <article key={s.id} className="card flex flex-col p-5">
                <div className="mb-2 flex gap-1"><span className="chip"><SportIcon slug={s.sport.slug} />{s.sport.name}</span><span className="chip">{s.skillLevel}</span>{full && <span className="chip !bg-red-100 !text-red-700">Đã đầy</span>}</div>
                <h2 className="font-bold">{s.title}</h2>
                <p className="mt-1 text-sm text-slate-500">Người tổ chức: {s.organizer.name}</p>
                <p className="text-sm">{s.venue?.name ?? "Địa điểm linh hoạt"} — {s.startAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p>
                <p className="text-sm">Chi phí dự kiến: {formatVND(s.costPerPerson)}/người</p>
                <p className="text-sm font-medium">{s.participants.length}/{s.maxParticipants} người tham gia</p>
                {s.description && <p className="mt-1 text-sm text-slate-600">{s.description}</p>}
                <div className="mt-auto pt-3">{user ? <JoinButton sessionId={s.id} initialJoined={joined} full={full} /> : <Link className="btn-primary !px-3 !py-1.5 text-sm" href="/login">Đăng nhập để tham gia</Link>}</div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
