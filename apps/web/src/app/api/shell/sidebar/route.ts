import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { avatarUrlOf } from "@/lib/shell/sidebar";
import { loadSidebar } from "@/lib/server/sidebar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limited = createRateLimiter(120, 60_000);

/** Số liệu của thanh bên (tên cửa hàng, kênh, số việc, số cảnh báo, gói). Tải nền sau khi trang đã hiện, không chặn việc chuyển trang. */
export async function GET() {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Quá nhiều yêu cầu, thử lại sau ít giây." }, { status: 429 });
  const name = (auth.user.user_metadata?.full_name as string | undefined) ?? auth.user.email ?? "";
  const data = await loadSidebar(supabase, auth.user.id, name, avatarUrlOf(auth.user.user_metadata));
  return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
}
