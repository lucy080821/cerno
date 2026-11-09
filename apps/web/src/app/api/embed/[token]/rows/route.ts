import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSharedDashboard } from "@/lib/server/embed";
import { fetchSourceRows } from "@/lib/server/source-rows";
import { clientIp, createRateLimiter } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mỗi lượt mở trang nhúng gọi một lần cho mỗi nguồn; 60 lượt/phút/IP là dư cho người dùng thật.
const limited = createRateLimiter(60, 60_000);
const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Dòng dữ liệu cho người xem công khai (trang nhúng). KHÔNG cần đăng nhập: mã chia sẻ trong URL là thứ duy nhất
 * bảo vệ dữ liệu. Chỉ trả nguồn mà dashboard đó thật sự dùng, và nguồn phải cùng workspace với dashboard.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const source = new URL(req.url).searchParams.get("source") ?? "";
  if (!UUID_RE.test(source)) return NextResponse.json({ error: "Nguồn không hợp lệ" }, { status: 400 });
  if (limited(clientIp(req))) return NextResponse.json({ error: "Quá nhiều yêu cầu, thử lại sau." }, { status: 429 });

  // Mọi trường hợp không hợp lệ đều trả cùng một lỗi 404 để không lộ mã nào tồn tại.
  const notFound = () => NextResponse.json({ error: "Link không còn hiệu lực" }, { status: 404 });

  const shared = await loadSharedDashboard(token);
  if (!shared?.doc) return notFound();
  if (!shared.doc.sources.some((s) => s.id === source && s.type === "google_sheets")) return notFound();

  const admin = createAdminClient();
  const { data: src } = await admin
    .from("data_sources")
    .select("id, workspace_id, last_synced_at")
    .eq("id", source)
    .maybeSingle();
  if (!src || src.workspace_id !== shared.workspaceId) return notFound();

  const { rows, error } = await fetchSourceRows(admin, source);
  if (error) return NextResponse.json({ error: "Không đọc được dữ liệu" }, { status: 500 });
  return NextResponse.json(
    { rows, syncedAt: src.last_synced_at },
    // Mã nằm trong URL nên có thể cache ngắn ở CDN/trình duyệt; thu hồi link sẽ có hiệu lực sau tối đa 1 phút.
    { headers: { "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=120" } },
  );
}
