import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { listChats } from "@/lib/server/ai-chat/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Danh sách cuộc trò chuyện của người dùng (mới nhất trước). */
export async function GET() {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ chats: await listChats(supabase) }, { headers: { "cache-control": "private, no-store" } });
}
