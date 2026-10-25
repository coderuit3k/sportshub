import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("common");
  return (
    <div className="space-y-6" aria-busy="true" aria-label={t("loadingAria")}>
      <div className="h-44 animate-pulse rounded-3xl bg-slate-200" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-40 animate-pulse rounded-3xl bg-slate-200" />
        <div className="h-40 animate-pulse rounded-3xl bg-slate-200" />
        <div className="h-40 animate-pulse rounded-3xl bg-slate-200" />
      </div>
      <p className="text-center text-sm text-slate-500">{t("loading")}</p>
    </div>
  );
}
