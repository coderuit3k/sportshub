import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getTranslations } from "next-intl/server";
import ProfileForm from "./ProfileForm";
import ChangePasswordForm from "./ChangePasswordForm";
export const dynamic = "force-dynamic";
export const metadata = { title: "Hồ sơ cá nhân" };
export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations("account");
  const [pref, sportPrefs, sports, favCount, bookingCount] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId: user.id } }),
    prisma.userSportPreference.findMany({ where: { userId: user.id } }),
    prisma.sport.findMany(),
    prisma.favorite.count({ where: { userId: user.id } }),
    prisma.booking.count({ where: { userId: user.id } }),
  ]);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="card p-6">
        <h1 className="text-2xl font-bold">{user.name}</h1>
        <p className="text-slate-500">{t("profileLine", { email: user.email, role: user.role })}</p>
        <p className="mt-2 text-sm">{t("profileStats", { bookings: bookingCount, favorites: favCount })}</p>
      </div>
      <ProfileForm
        initialName={user.name}
        initialDistrict={pref?.preferredDistrict ?? ""}
        initialTime={pref?.preferredTimeRange ?? ""}
        sports={sports.map((s) => ({ id: s.id, name: s.name, slug: s.slug }))}
        initialSportIds={sportPrefs.map((p) => p.sportId)}
      />
      <ChangePasswordForm />
    </div>
  );
}
