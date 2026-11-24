import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "@/lib/account-utils";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { deleteChat, getChat, listMessages, updateChat } from "@/lib/server/ai-chat/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const IdSchema = z.string().uuid();
const bad = (m: string, s: number) => NextResponse.json({ error: m }, { status: s });

/** Một cuộc trò chuyện: thông tin + toàn bộ tin nhắn. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return bad("Không tìm thấy", 404);
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  const chat = await getChat(supabase, id);
  if (!chat) return bad("Không tìm thấy", 404);
  return NextResponse.json({ chat, messages: await listMessages(supabase, id) }, { headers: { "cache-control": "private, no-store" } });
}

const Patch = z.object({ title: z.string().trim().min(1).max(120) });

/** Đổi tên cuộc trò chuyện. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return bad("Không tìm thấy", 404);
  if (!sameOrigin(req.headers.get("origin"), req.headers.get("host"))) return bad("Yêu cầu không hợp lệ", 403);
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  const body = Patch.safeParse(await req.json().catch(() => null));
  if (!body.success) return bad("Tên không hợp lệ", 400);
  if (!(await getChat(supabase, id))) return bad("Không tìm thấy", 404);
  if (!(await updateChat(supabase, id, { title: body.data.title }))) return bad("Không lưu được", 500);
  return NextResponse.json({ ok: true });
}

/** Xoá cuộc trò chuyện (tin nhắn xoá theo). */
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return bad("Không tìm thấy", 404);
  if (!sameOrigin(req.headers.get("origin"), req.headers.get("host"))) return bad("Yêu cầu không hợp lệ", 403);
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  if (!(await deleteChat(supabase, id))) return bad("Không xoá được", 500);
  return NextResponse.json({ ok: true });
}
