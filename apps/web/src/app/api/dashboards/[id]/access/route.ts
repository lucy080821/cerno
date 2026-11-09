import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { normalizeEmail } from "@/lib/embed/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string }> };
type Role = "viewer" | "editor";
const isRole = (r: unknown): r is Role => r === "viewer" || r === "editor";

/**
 * Mời người khác theo email Google với quyền Xem hoặc Sửa. Chỉ "owner" của dashboard quản lý được (RLS + kiểm tra rõ ràng).
 * Người được mời không vào workspace của chủ: họ chỉ chạm được đúng dashboard này (xem migration 0008).
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
  return { supabase, id, myEmail: (user.email ?? "").toLowerCase() } as const;
}

async function list(c: Exclude<Awaited<ReturnType<typeof context>>, { error: unknown }>) {
  const { data, error } = await c.supabase
    .from("dashboard_access")
    .select("email, role, created_at")
    .eq("dashboard_id", c.id)
    .order("created_at");
  if (error) return NextResponse.json({ error: "Không đọc được danh sách" }, { status: 500 });
  return NextResponse.json({ people: data }, { headers: { "cache-control": "private, no-store" } });
}

export async function GET(_req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  return list(c);
}

/** body: { email, role } — thêm hoặc đổi quyền của một email. */
export async function POST(req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const body = (await req.json().catch(() => null)) as { email?: unknown; role?: unknown } | null;
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : null;
  if (!email) return NextResponse.json({ error: "Email không hợp lệ" }, { status: 400 });
  if (!isRole(body?.role)) return NextResponse.json({ error: "Quyền không hợp lệ" }, { status: 400 });
  if (email === c.myEmail) return NextResponse.json({ error: "Đây là email của bạn, bạn đã có toàn quyền." }, { status: 400 });

  const { error } = await c.supabase
    .from("dashboard_access")
    .upsert({ dashboard_id: c.id, email, role: body.role }, { onConflict: "dashboard_id,email" });
  if (error) {
    const msg = error.message.includes("access_limit") ? "Đã đạt tối đa 50 người được mời." : "Không thêm được người này.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return list(c);
}

/** body: { email } — thu hồi quyền. */
export async function DELETE(req: Request, ctx: Params) {
  const c = await context(ctx);
  if ("error" in c) return c.error;
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : null;
  if (!email) return NextResponse.json({ error: "Email không hợp lệ" }, { status: 400 });
  const { error } = await c.supabase.from("dashboard_access").delete().eq("dashboard_id", c.id).eq("email", email);
  if (error) return NextResponse.json({ error: "Không thu hồi được" }, { status: 500 });
  return list(c);
}
