import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const newToken = () => randomBytes(24).toString("base64url"); // 32 ký tự

type Params = { params: Promise<{ id: string }> };
const view = (token: string | null) => ({ enabled: !!token, token });

/**
 * Link xem công khai trên Cerno (ai có link cũng xem và lọc được, không sửa được).
 * RLS (bảng dashboard_links) chỉ cho "owner" của dashboard bật/tắt/đổi link.
 */
async function context(ctx: Params) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return { error: NextResponse.json({ error: "ID không hợp lệ" }, { status: 400 }) } as const;
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return { error: auth.response } as const;
  const { user } = auth;
  const { data: role } = await supabase.rpc("dashboard_role", { d: id });
  if (role !== "owner") return { error: NextResponse.json({ error: "Bạn không có quyền chia sẻ dashboard này" }, { status: 403 }) } as const;
  return { supabase, id } as const;
}

export async function GET(_req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const { data, error } = await c.supabase.from("dashboard_links").select("token").eq("dashboard_id", c.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Không đọc được cài đặt link" }, { status: 500 });
  return NextResponse.json(view(data?.token ?? null), { headers: { "cache-control": "private, no-store" } });
}

/** body: { action: "enable" | "rotate" | "disable" } */
export async function POST(req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const action = ((await req.json().catch(() => null)) as { action?: string } | null)?.action;

  if (action === "disable") {
    const { error } = await c.supabase.from("dashboard_links").delete().eq("dashboard_id", c.id);
    if (error) return NextResponse.json({ error: "Không tắt được link" }, { status: 500 });
    return NextResponse.json(view(null));
  }
  if (action === "enable" || action === "rotate") {
    const { data: cur } = await c.supabase.from("dashboard_links").select("token").eq("dashboard_id", c.id).maybeSingle();
    if (cur && action === "enable") return NextResponse.json(view(cur.token));
    const token = newToken();
    const q = cur
      ? c.supabase.from("dashboard_links").update({ token, updated_at: new Date().toISOString() }).eq("dashboard_id", c.id)
      : c.supabase.from("dashboard_links").insert({ dashboard_id: c.id, token });
    const { data, error } = await q.select("token").maybeSingle();
    if (error || !data) return NextResponse.json({ error: "Không tạo được link" }, { status: 500 });
    return NextResponse.json(view(data.token));
  }
  return NextResponse.json({ error: "Thao tác không hợp lệ" }, { status: 400 });
}
