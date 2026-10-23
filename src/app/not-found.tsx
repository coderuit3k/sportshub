import Link from "next/link";
import { Compass } from "lucide-react";

export const metadata = { title: "Không tìm thấy trang" };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <Compass className="mx-auto h-14 w-14 text-secondary" aria-hidden />
      <p className="mt-4 text-6xl font-extrabold text-primary">404</p>
      <h1 className="mt-2 text-2xl font-bold">Không tìm thấy trang này</h1>
      <p className="mt-2 text-slate-500">
        Trang bạn tìm có thể đã bị di chuyển, hoặc sân này chưa được duyệt hiển thị. Kiểm tra lại đường dẫn nhé.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className="btn-primary">Về trang chủ</Link>
        <Link href="/venues" className="btn-outline">Khám phá sân</Link>
      </div>
    </div>
  );
}
