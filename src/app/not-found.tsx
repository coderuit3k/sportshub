import Link from "next/link";
import { Compass } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Không tìm thấy trang" };

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <Compass className="mx-auto h-14 w-14 text-secondary" aria-hidden />
      <p className="mt-4 text-6xl font-extrabold text-primary">404</p>
      <h1 className="mt-2 text-2xl font-bold">{t("notFoundTitle")}</h1>
      <p className="mt-2 text-slate-500">{t("notFoundBody")}</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className="btn-primary">{t("backHome")}</Link>
        <Link href="/venues" className="btn-outline">{t("exploreVenues")}</Link>
      </div>
    </div>
  );
}
