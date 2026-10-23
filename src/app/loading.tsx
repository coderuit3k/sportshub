export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Đang tải">
      <div className="h-44 animate-pulse rounded-3xl bg-slate-200" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-40 animate-pulse rounded-3xl bg-slate-200" />
        <div className="h-40 animate-pulse rounded-3xl bg-slate-200" />
        <div className="h-40 animate-pulse rounded-3xl bg-slate-200" />
      </div>
      <p className="text-center text-sm text-slate-500">Đang tải…</p>
    </div>
  );
}
