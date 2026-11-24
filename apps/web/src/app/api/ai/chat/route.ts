import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "@/lib/account-utils";
import { createClient } from "@/lib/supabase/server";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { requireUser } from "@/lib/server/session-user";
import { membershipOf } from "@/lib/server/profit";
import { ChatCaller } from "@/lib/server/ai-chat/caller";
import { chatRouterDeps, liveToolDeps } from "@/lib/server/ai-chat/live";
import { runChat, type RunEvent } from "@/lib/server/ai-chat/run";
import { loadSources, MAX_SELECTED_SOURCES } from "@/lib/server/ai-chat/sources";
import { addMessage, createChat, getChat, loadHistory, MAX_QUESTION_CHARS, titleFrom, updateChat } from "@/lib/server/ai-chat/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Mỗi câu hỏi là nhiều lần gọi AI và truy vấn: giới hạn chặt hơn các API khác.
const limited = createRateLimiter(10, 60_000);

const Body = z.object({
  chatId: z.string().uuid().nullish(),
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  sourceIds: z.array(z.string().uuid()).max(MAX_SELECTED_SOURCES),
  lang: z.enum(["vi", "en"]).default("vi"),
});

const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status });

/**
 * Trang Hỏi AI: một câu hỏi → AI tự tra số liệu bằng công cụ (nhiều vòng) → viết báo cáo chữ thuần. Trả luồng NDJSON:
 * {t:"chat",id,title} → {t:"status"|"text"|"reset"}… → {t:"done",message} hoặc {t:"error",message}.
 * Câu hỏi và câu trả lời được lưu vào lịch sử (ai_chats / ai_messages) qua RLS.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req.headers.get("origin"), req.headers.get("host"))) return fail("Yêu cầu không hợp lệ", 403);
  const routerDeps = chatRouterDeps();
  if (!routerDeps) return fail("Chưa cấu hình dịch vụ AI trên server.", 503);

  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (limited(user.id)) return fail("Bạn hỏi quá nhanh, thử lại sau một phút.", 429);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail("Yêu cầu không hợp lệ", 400);
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail(parsed.error.issues[0]?.path[0] === "question" ? "Câu hỏi trống hoặc quá dài." : "Yêu cầu không hợp lệ", 400);
  const { chatId, question, sourceIds, lang } = parsed.data;

  const member = await membershipOf(supabase, user.id);
  if (!member) return fail("Bạn chưa có workspace", 403);

  // Nguồn đọc qua RLS: id không thuộc quyền người dùng bị bỏ qua.
  const sources = await loadSources(supabase, sourceIds);
  const usable = sources.map((s) => s.id);

  let chat = chatId ? await getChat(supabase, chatId) : null;
  if (chatId && !chat) return fail("Không tìm thấy cuộc trò chuyện", 404);
  const isNew = !chat;
  if (!chat) {
    chat = await createChat(supabase, { workspaceId: member.workspaceId, userId: user.id, title: titleFrom(question), sourceIds: usable });
    if (!chat) return fail("Không tạo được cuộc trò chuyện (đã đạt giới hạn hoặc chưa chạy migration 0023).", 409);
  }
  const history = isNew ? [] : await loadHistory(supabase, chat.id);
  const saved = await addMessage(supabase, chat.id, "user", question);
  if (!saved) return fail("Không lưu được câu hỏi (cuộc trò chuyện đã quá dài, hãy bắt đầu cuộc mới).", 409);
  if (!isNew) await updateChat(supabase, chat.id, { sourceIds: usable });

  const caller = new ChatCaller(user.id, routerDeps);
  const tools = liveToolDeps(supabase);
  const enc = new TextEncoder();
  const chatRow = chat;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => {
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
        } catch {
          /* client đã đóng kết nối */
        }
      };
      send({ t: "chat", id: chatRow.id, title: chatRow.title });
      try {
        for await (const ev of runChat({ history, question, sources, lang, signal: req.signal }, { caller, tools }) as AsyncGenerator<RunEvent>) {
          if (ev.t === "final") {
            const meta = { ...ev.meta, sources: sources.map((s) => s.name), lang };
            const msg = await addMessage(supabase, chatRow.id, "assistant", ev.text, meta);
            await updateChat(supabase, chatRow.id, {});
            send({ t: "done", message: msg ?? { id: "", role: "assistant", content: ev.text, meta, createdAt: new Date().toISOString() } });
          } else send(ev);
        }
      } catch (e) {
        console.error("[api/ai/chat]", e instanceof Error ? e.message : e);
        send({ t: "error", message: "AI gặp lỗi khi tra cứu, hãy thử lại." });
      } finally {
        try {
          controller.close();
        } catch {
          /* đã đóng */
        }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
