import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { SESSIONS_TAG } from "@/lib/public-data";
import { changeSessionParticipation } from "@/services/sessions";
import { notify } from "@/lib/notifications";
import { sessionJoinLimiter, tooManyRequests } from "@/lib/rate-limit";

const schema = z.object({ action: z.enum(["join", "leave"]) });
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  // Join/leave flapping brake: 30 attempts per 10 minutes per user, both
  // actions counted (specific bucket — not also in the generic write bucket).
  const gate = await sessionJoinLimiter.consume(`session-join:${user.id}`);
  if (!gate.allowed) return tooManyRequests(gate);
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  try {
    const result = await changeSessionParticipation(id, user.id, parsed.data.action);
    revalidateTag(SESSIONS_TAG);
    if (result.joined) {
      await notify(result.session.organizerId, "SESSION", "Có người tham gia kèo", `${user.name} vừa tham gia: ${result.session.title}`, id, `join-${id}-${user.id}`);
    }
    return NextResponse.json({ joined: result.joined });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const errors: Record<string, [string, number]> = {
      SESSION_NOT_FOUND: ["Không tìm thấy kèo", 404],
      SESSION_ALREADY_JOINED: ["Bạn đã tham gia kèo này rồi", 409],
      SESSION_FULL: ["Kèo đã đầy", 409],
      SESSION_CLOSED: ["Kèo đã kết thúc hoặc bị hủy", 409],
      SESSION_BUSY: ["Kèo vừa được cập nhật, vui lòng thử lại", 409],
    };
    const known = errors[code];
    if (!known) {
      console.error("[session-participation] unexpected error", error);
      return NextResponse.json({ error: "Không cập nhật được kèo" }, { status: 500 });
    }
    const [message, status] = known;
    return NextResponse.json({ error: message, code }, { status });
  }
}
