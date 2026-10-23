"use client";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <AlertTriangle className="mx-auto h-14 w-14 text-accent" aria-hidden />
      <h1 className="mt-4 text-2xl font-bold">Đã có lỗi xảy ra</h1>
      <p className="mt-2 text-slate-500">
        Hệ thống gặp sự cố tạm thời khi tải trang này. Bạn thử lại một lần nữa nhé — nếu vẫn lỗi, quay lại sau ít phút.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" className="btn-primary" onClick={() => reset()}>Thử lại</button>
        <Link href="/" className="btn-outline">Về trang chủ</Link>
      </div>
    </div>
  );
}
