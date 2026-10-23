import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "vietnamese"], variable: "--font-jakarta" });
const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "SportsHub — Find Your Sport. Find Your Court. Find Your People.", template: "%s | SportsHub" },
  description: "Nền tảng khám phá, đặt sân và kết nối cộng đồng thể thao tại Việt Nam.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${jakarta.variable} ${inter.variable}`}>
      <body className="font-sans">
        <Header />
        <main className="mx-auto min-h-[70vh] max-w-7xl px-4 py-6">{children}</main>
        <footer className="mt-12 bg-ink text-slate-300">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 text-sm md:grid-cols-3">
            <div><p className="mb-2 text-base font-bold text-white">SportsHub Vietnam</p><p>Sports for Everyone. Find Your Place. Play Together.</p></div>
            <div><p className="mb-2 font-bold text-white">Liên hệ</p><p>TP. Hồ Chí Minh, Việt Nam<br />hotro@sportshub.example</p></div>
            <div><p className="mb-2 font-bold text-white">Chính sách</p><p>Thanh toán qua VietQR/MoMo hoặc tại quầy. Xem chính sách hủy ở từng sân.</p></div>
          </div>
        </footer>
      </body>
    </html>
  );
}
