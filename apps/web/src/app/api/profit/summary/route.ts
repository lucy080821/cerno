import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { computeProfit, findOrdersSource, loadCatalog, membershipOf } from "@/lib/server/profit";
import { buildTodos } from "@/lib/profit/todos";
import { FEE_CHANNEL } from "@/lib/fees/constants";
import { feePayload, loadFeeConfig } from "@/lib/server/fees";

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
  const member = await membershipOf(supabase, auth.user.id);
  if (!member) return NextResponse.json({ error: "Bạn chưa có workspace" }, { status: 403 });
  const { workspaceId, editable } = member;

  // Ba truy vấn độc lập chạy song song (trước đây nối đuôi nhau).
  const [source, catalog, fees] = await Promise.all([findOrdersSource(supabase, workspaceId), loadCatalog(supabase, workspaceId), loadFeeConfig(supabase, workspaceId)]);
  if (!source) {
    return NextResponse.json({ source: null, editable, catalog: { available: catalog.available, entries: catalog.entries } }, { headers: { "cache-control": "private, no-store" } });
  }
  try {
    const { summary } = await computeProfit(source.id, fees);
    return NextResponse.json(
      { source, editable, summary, todos: buildTodos(summary), catalog: { available: catalog.available, entries: catalog.entries }, fees: feePayload(fees, summary.products.filter((p) => p.channels.includes(FEE_CHANNEL)).map((p) => ({ key: p.key, name: p.name }))) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (e) {
    console.error("[api/profit/summary]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Không tính được lãi, thử lại sau." }, { status: 502 });
  }
}
