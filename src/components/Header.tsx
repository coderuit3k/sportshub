import Link from "next/link";
import { Trophy, Bell, Heart } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import LogoutButton from "./LogoutButton";

export default async function Header() {
  const user = await getCurrentUser();
  let unread = 0;
  if (user) unread = await prisma.notification.count({ where: { userId: user.id, isRead: false } });
  return (
    <header className="sticky top-0 z-40 bg-primary text-white shadow">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <Trophy className="h-6 w-6 text-accent" /> SportsHub
        </Link>
        <nav className="ml-4 hidden items-center gap-4 text-sm font-medium md:flex" aria-label="Chính">
          <Link className="hover:text-accent" href="/">Trang chủ</Link>
          <Link className="hover:text-accent" href="/venues">Tìm sân</Link>
          <Link className="hover:text-accent" href="/community">Play Together</Link>
          {user && <Link className="hover:text-accent" href="/my-bookings">Lịch đặt của tôi</Link>}
          {user?.role === "OWNER" && <Link className="hover:text-accent" href="/owner">Kênh chủ sân</Link>}
          {user?.role === "ADMIN" && <Link className="hover:text-accent" href="/admin">Admin</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {user ? (
            <>
              <Link href="/favorites" aria-label="Yêu thích" className="hover:text-accent"><Heart className="h-5 w-5" /></Link>
              <Link href="/notifications" aria-label="Thông báo" className="relative hover:text-accent">
                <Bell className="h-5 w-5" />
                {unread > 0 && <span className="absolute -right-2 -top-2 rounded-full bg-accent px-1.5 text-[10px] font-bold text-ink">{unread}</span>}
              </Link>
              <Link href="/profile" className="hidden font-medium hover:text-accent sm:block">{user.name}</Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="font-medium hover:text-accent">Đăng nhập</Link>
              <Link href="/register" className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-ink hover:opacity-90">Đăng ký</Link>
            </>
          )}
        </div>
      </div>
      <nav className="flex gap-4 overflow-x-auto px-4 pb-2 text-sm md:hidden" aria-label="Di động">
        <Link href="/venues">Tìm sân</Link><Link href="/community">Play Together</Link>
        {user && <Link href="/my-bookings">Lịch đặt</Link>}
      </nav>
    </header>
  );
}
