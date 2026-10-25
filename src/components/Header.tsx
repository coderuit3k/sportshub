import Link from "next/link";
import { Trophy, Bell, Heart } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import LogoutButton from "./LogoutButton";
import LanguageSwitcher from "./LanguageSwitcher";

export default async function Header() {
  const user = await getCurrentUser();
  const t = await getTranslations("nav");
  let unread = 0;
  if (user) unread = await prisma.notification.count({ where: { userId: user.id, isRead: false } });
  return (
    <header className="sticky top-0 z-40 bg-primary text-white shadow">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <Trophy className="h-6 w-6 text-accent" /> SportsHub
        </Link>
        <nav className="ml-4 hidden items-center gap-4 text-sm font-medium md:flex" aria-label={t("mainLabel")}>
          <Link className="hover:text-accent" href="/">{t("home")}</Link>
          <Link className="hover:text-accent" href="/venues">{t("venues")}</Link>
          <Link className="hover:text-accent" href="/community">{t("community")}</Link>
          {user && <Link className="hover:text-accent" href="/my-bookings">{t("myBookings")}</Link>}
          {user?.role === "OWNER" && <Link className="hover:text-accent" href="/owner">{t("owner")}</Link>}
          {user?.role === "ADMIN" && <Link className="hover:text-accent" href="/admin">{t("admin")}</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {/* In the always-visible top bar, so the mobile nav has it too. */}
          <LanguageSwitcher />
          {user ? (
            <>
              <Link href="/favorites" aria-label={t("favorites")} className="hover:text-accent"><Heart className="h-5 w-5" /></Link>
              <Link href="/notifications" aria-label={t("notifications")} className="relative hover:text-accent">
                <Bell className="h-5 w-5" />
                {unread > 0 && <span className="absolute -right-2 -top-2 rounded-full bg-accent px-1.5 text-[10px] font-bold text-ink">{unread}</span>}
              </Link>
              <Link href="/profile" className="hidden font-medium hover:text-accent sm:block">{user.name}</Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="font-medium hover:text-accent">{t("login")}</Link>
              <Link href="/register" className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-ink hover:opacity-90">{t("register")}</Link>
            </>
          )}
        </div>
      </div>
      <nav className="flex gap-4 overflow-x-auto px-4 pb-2 text-sm md:hidden" aria-label={t("mobileLabel")}>
        <Link href="/venues">{t("venues")}</Link><Link href="/community">{t("community")}</Link>
        {user && <Link href="/my-bookings">{t("myBookingsShort")}</Link>}
      </nav>
    </header>
  );
}
