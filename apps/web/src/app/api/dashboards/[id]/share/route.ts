import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { MAX_EMBED_DOMAINS, parseDomains } from "@/lib/embed/domains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const newToken = () => randomBytes(24).toString("base64url"); // 32 ký tự

type Params = { params: Promise<{ id: string }> };

/**
 * Cài đặt chia sẻ/nhúng của một dashboard. Dùng client của người dùng nên RLS (bảng dashboard_shares)
 * và kiểm tra vai trò "owner" ở trên đảm bảo chỉ owner/editor của workspace mới đọc/đổi được.
 */
async function context(ctx: Params) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return { error: NextResponse.json({ error: "ID không hợp lệ" }, { status: 400 }) } as const;
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return { error: auth.response } as const;
  const { user } = auth;
  // Chỉ "owner" (thành viên owner/editor của workspace chứa dashboard) được quản lý chia sẻ, không phải người được mời sửa.
  const { data: role } = await supabase.rpc("dashboard_role", { d: id });
  if (role !== "owner") return { error: NextResponse.json({ error: "Bạn không có quyền chia sẻ dashboard này" }, { status: 403 }) } as const;
  return { supabase, id } as const;
}

type ShareRow = { token: string; embed_domains: string[] };
const view = (row: ShareRow | null) =>
  row ? { enabled: true, token: row.token, domains: row.embed_domains } : { enabled: false, token: null, domains: [] as string[] };

export async function GET(_req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const { data, error } = await c.supabase
    .from("dashboard_shares")
    .select("token, embed_domains")
    .eq("dashboard_id", c.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Không đọc được cài đặt chia sẻ" }, { status: 500 });
  return NextResponse.json(view(data), { headers: { "cache-control": "private, no-store" } });
}

/** body: { action: "enable" | "rotate" | "disable" } */
export async function POST(req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;

  if (action === "disable") {
    const { error } = await c.supabase.from("dashboard_shares").delete().eq("dashboard_id", c.id);
    if (error) return NextResponse.json({ error: "Không tắt được chia sẻ (bạn có quyền sửa dashboard này không?)" }, { status: 403 });
    return NextResponse.json(view(null));
  }

  if (action === "enable" || action === "rotate") {
    const { data: cur } = await c.supabase
      .from("dashboard_shares")
      .select("token, embed_domains")
      .eq("dashboard_id", c.id)
      .maybeSingle();
    if (cur && action === "enable") return NextResponse.json(view(cur));
    if (cur) {
      const { data, error } = await c.supabase
        .from("dashboard_shares")
        .update({ token: newToken(), updated_at: new Date().toISOString() })
        .eq("dashboard_id", c.id)
        .select("token, embed_domains")
        .maybeSingle();
      if (error || !data) return NextResponse.json({ error: "Không tạo lại được link" }, { status: 403 });
      return NextResponse.json(view(data));
    }
    // Chưa có: tạo mới. Danh sách tên miền rỗng = chưa ai nhúng được (an toàn mặc định).
    const { data, error } = await c.supabase
      .from("dashboard_shares")
      .insert({ dashboard_id: c.id, token: newToken() })
      .select("token, embed_domains")
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: "Không bật được chia sẻ (bạn có quyền sửa dashboard này không?)" }, { status: 403 });
    return NextResponse.json(view(data));
  }

  return NextResponse.json({ error: "Thao tác không hợp lệ" }, { status: 400 });
}

/** body: { domains: string[] }. Chuẩn hoá và kiểm tra ở server, không tin dữ liệu từ trình duyệt. */
export async function PUT(req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const body = (await req.json().catch(() => null)) as { domains?: unknown } | null;
  if (!body || !Array.isArray(body.domains) || body.domains.some((d) => typeof d !== "string") || body.domains.length > 200) {
    return NextResponse.json({ error: "Danh sách tên miền không hợp lệ" }, { status: 400 });
  }
  const parsed = parseDomains((body.domains as string[]).join("\n"));
  if (parsed.invalid.length) {
    return NextResponse.json({ error: `Tên miền không hợp lệ: ${parsed.invalid.slice(0, 3).join(", ")}` }, { status: 400 });
  }
  if (parsed.tooMany) return NextResponse.json({ error: `Tối đa ${MAX_EMBED_DOMAINS} tên miền.` }, { status: 400 });

  const { data, error } = await c.supabase
    .from("dashboard_shares")
    .update({ embed_domains: parsed.domains, updated_at: new Date().toISOString() })
    .eq("dashboard_id", c.id)
    .select("token, embed_domains")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Không lưu được tên miền" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Hãy bật chia sẻ trước." }, { status: 409 });
  return NextResponse.json(view(data));
}
