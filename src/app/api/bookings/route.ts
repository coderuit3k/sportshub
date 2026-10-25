import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createBooking } from "@/services/bookings";
import { bookingLimiter, tooManyRequests } from "@/lib/rate-limit";

const schema = z.object({
  facilityId: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  idempotencyKey: z.string().min(8),
});
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  const gate = await bookingLimiter.consume(`booking:${user.id}`);
  if (!gate.allowed) return tooManyRequests(gate);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  try {
    const { booking, created } = await createBooking({
      userId: user.id, facilityId: parsed.data.facilityId,
      startAt: new Date(parsed.data.startAt), endAt: new Date(parsed.data.endAt),
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json({ booking, created }, { status: created ? 201 : 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "UNKNOWN";
    const map: Record<string, [string, number]> = {
      SLOT_TAKEN: ["Khung giờ này vừa có người đặt — vui lòng chọn giờ khác", 409],
      SLOT_BLOCKED: ["Khung giờ này sân đang khóa lịch", 409],
      VENUE_NOT_APPROVED: ["Sân chưa được duyệt", 400],
      INVALID_DURATION: ["Thời lượng phải là số giờ nguyên từ 1–6 giờ", 400],
      IN_THE_PAST: ["Không thể đặt giờ trong quá khứ", 400],
      FACILITY_NOT_FOUND: ["Không tìm thấy sân con", 404],
    };
    const [text, status] = map[msg] ?? ["Không tạo được đặt sân", 500];
    return NextResponse.json({ error: text, code: msg }, { status });
  }
}
