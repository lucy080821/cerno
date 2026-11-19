import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { computeProfit, findOrdersSource, loadCatalog, workspaceOf } from "@/lib/server/profit";
import { buildTodos } from "@/lib/profit/todos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limited = createRateLimiter(120, 60_000);

/** Tổng hợp lãi từng đơn của workspace: số liệu cho các trang Lãi lỗ, Hoàn và hủy, Việc cần làm, Sản phẩm và giá vốn. */
export async function GET() {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Quá nhiều yêu cầu, thử lại sau ít giây." }, { status: 429 });
  const workspaceId = await workspaceOf(supabase, auth.user.id);
  if (!workspaceId) return NextResponse.json({ error: "Bạn chưa có workspace" }, { status: 403 });
  const editable = (await workspaceOf(supabase, auth.user.id, true)) === workspaceId;

  const [source, catalog] = await Promise.all([findOrdersSource(supabase, workspaceId), loadCatalog(supabase, workspaceId)]);
  if (!source) {
    return NextResponse.json({ source: null, editable, catalog: { available: catalog.available, entries: catalog.entries } }, { headers: { "cache-control": "private, no-store" } });
  }
  try {
    const { summary } = await computeProfit(source.id);
    return NextResponse.json(
      { source, editable, summary, todos: buildTodos(summary), catalog: { available: catalog.available, entries: catalog.entries } },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (e) {
    console.error("[api/profit/summary]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Không tính được lãi, thử lại sau." }, { status: 502 });
  }
}
