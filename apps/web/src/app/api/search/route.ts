import { NextResponse } from "next/server";
import { normalizeText } from "@dashboard/schema";
import { createClient } from "@/lib/supabase/server";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { requireUser } from "@/lib/server/session-user";
import { computeProfitFor, findOrdersSource, membershipOf } from "@/lib/server/profit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const limited = createRateLimiter(90, 60_000);
const LIMIT = 5;

/** Bỏ ký tự đặc biệt của LIKE để từ khoá người dùng gõ không đổi nghĩa câu lọc. */
const likeSafe = (q: string) => q.replace(/[%_\\,()]/g, " ").trim();

export interface SearchHits {
  dashboards: { id: string; name: string }[];
  sources: { id: string; name: string }[];
  products: { key: string; name: string }[];
  orders: { id: string; channel: string; date: string | null }[];
}

/**
 * Tìm dữ liệu của người dùng cho ô tìm kiếm: dashboard, nguồn dữ liệu, sản phẩm (tên/SKU) và mã đơn. Đọc qua RLS bằng client của
 * người dùng; sản phẩm và đơn lấy từ bộ nhớ đệm tính lãi nên không đọc lại dữ liệu thô. Phần sản phẩm/đơn lỗi thì bỏ qua, không
 * làm hỏng phần còn lại. Không bao giờ trả thông tin người mua (nguồn đơn hàng không lưu).
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Quá nhiều yêu cầu, thử lại sau ít giây." }, { status: 429 });

  const raw = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 60).trim();
  const empty: SearchHits = { dashboards: [], sources: [], products: [], orders: [] };
  if (raw.length < 2) return NextResponse.json(empty);
  const like = `%${likeSafe(raw)}%`;
  const needle = normalizeText(raw);
  const lower = raw.toLowerCase();

  const member = await membershipOf(supabase, auth.user.id);
  if (!member) return NextResponse.json(empty);

  const [dashboards, sources, profit] = await Promise.all([
    (async () => {
      try {
        const { data } = await supabase.from("dashboards").select("id, name").eq("workspace_id", member.workspaceId).ilike("name", like).order("updated_at", { ascending: false }).limit(LIMIT);
        return (data ?? []).map((r) => ({ id: r.id as string, name: ((r.name as string | null) ?? "").trim() || "Dashboard" }));
      } catch {
        return [];
      }
    })(),
    (async () => {
      try {
        const { data } = await supabase.from("data_sources").select("id, name, sheet_name").eq("workspace_id", member.workspaceId).or(`name.ilike.${like},sheet_name.ilike.${like}`).limit(LIMIT);
        return (data ?? []).map((r) => ({ id: r.id as string, name: ((r.name as string | null) ?? (r.sheet_name as string | null) ?? "Nguồn dữ liệu").trim() }));
      } catch {
        return [];
      }
    })(),
    (async () => {
      try {
        const src = await findOrdersSource(supabase, member.workspaceId);
        if (!src) return null;
        return await computeProfitFor(supabase, member.workspaceId, src.id);
      } catch {
        return null;
      }
    })(),
  ]);

  const products = (profit?.summary.products ?? [])
    .filter((p) => normalizeText(`${p.name} ${p.key}`).includes(needle))
    .slice(0, LIMIT)
    .map((p) => ({ key: p.key, name: p.name }));
  // Mã đơn: cần ít nhất 3 ký tự để không trả về cả nghìn đơn.
  const orders = raw.length >= 3 && profit
    ? profit.orders.filter((o) => o.hasId && o.id.toLowerCase().includes(lower)).slice(0, LIMIT).map((o) => ({ id: o.id, channel: o.channel, date: o.date }))
    : [];

  const hits: SearchHits = { dashboards, sources, products, orders };
  return NextResponse.json(hits, { headers: { "cache-control": "private, no-store" } });
}
