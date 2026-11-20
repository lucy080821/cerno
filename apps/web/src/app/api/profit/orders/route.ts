import { NextResponse, type NextRequest } from "next/server";
import { loadFeeConfig } from "@/lib/server/fees";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { computeProfit, findOrdersSource, membershipOf } from "@/lib/server/profit";
import { filterOrders, orderCounts, sortOrders, type OrderFilter, type OrderSort } from "@/lib/profit/order-profit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limited = createRateLimiter(240, 60_000);
const PAGE_SIZE = 50;
const FILTERS: OrderFilter[] = ["all", "loss", "thin", "missing", "return"];

/** Danh sách đơn kèm lãi từng đơn: lọc (đang lỗ, lãi mỏng, thiếu giá vốn, hoàn/hủy), tìm theo mã đơn/SKU/tên, phân trang. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Quá nhiều yêu cầu, thử lại sau ít giây." }, { status: 429 });
  const member = await membershipOf(supabase, auth.user.id);
  if (!member) return NextResponse.json({ error: "Bạn chưa có workspace" }, { status: 403 });
  const { workspaceId } = member;

  const sp = req.nextUrl.searchParams;
  const filter = (FILTERS as string[]).includes(sp.get("filter") ?? "") ? (sp.get("filter") as OrderFilter) : "all";
  const sort: OrderSort = sp.get("sort") === "profit" ? "profit" : "date";
  const q = (sp.get("q") ?? "").slice(0, 100);
  const channel = (sp.get("channel") ?? "").slice(0, 60) || undefined;
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(sp.get("page")) || 1)));

  const [source, fees] = await Promise.all([findOrdersSource(supabase, workspaceId), loadFeeConfig(supabase, workspaceId)]);
  if (!source) return NextResponse.json({ source: null, orders: [], total: 0, page: 1, pageSize: PAGE_SIZE, counts: null, channels: [] });
  try {
    const { orders } = await computeProfit(source.id, fees);
    const list = sortOrders(filterOrders(orders, filter, q, channel), sort);
    return NextResponse.json(
      {
        source,
        counts: orderCounts(channel ? orders.filter((o) => o.channel === channel) : orders),
        channels: [...new Set(orders.map((o) => o.channel))],
        total: list.length,
        page,
        pageSize: PAGE_SIZE,
        orders: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (e) {
    console.error("[api/profit/orders]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Không tải được danh sách đơn, thử lại sau." }, { status: 502 });
  }
}
