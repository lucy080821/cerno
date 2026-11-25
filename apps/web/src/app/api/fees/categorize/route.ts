import { z } from "@dashboard/schema";
import { sameOrigin } from "@/lib/account-utils";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { workspaceOf } from "@/lib/server/profit";
import { loadFeeConfig, sellerTypeOf } from "@/lib/server/fees";
import { FEE_PLATFORMS } from "@/lib/fees/constants";
import { ChatCaller } from "@/lib/server/ai-chat/caller";
import { chatRouterDeps } from "@/lib/server/ai-chat/live";
import { categorizeProducts, FatalAskError } from "@/lib/server/fee-categorize/core";
import { makeAsk } from "@/lib/server/fee-categorize/ask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Tối đa sản phẩm mỗi lần chạy: đủ vài trăm sản phẩm bán chạy, chi phí AI vẫn nhỏ (cả lượt chỉ giữ chỗ MỘT lượt AI trả phí). */
const MAX_PRODUCTS = 400;
const limited = createRateLimiter(3, 10 * 60_000);
const Body = z.object({
  platform: z.enum(FEE_PLATFORMS),
  products: z.array(z.object({ key: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(300) })).min(1).max(MAX_PRODUCTS),
});

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * AI phân ngành hàng loạt (owner/editor). Trả luồng NDJSON: `{t:"progress",done,total}` ... rồi `{t:"done",results:[{key,path,ratePct}],unassigned:[key],failedCalls}`
 * hoặc `{t:"error",message}`. KHÔNG tự lưu: trình duyệt lưu kết quả qua PUT /api/fees (source "ai"), nên vẫn qua RLS và kiểm ngành có trong biểu.
 * Chỉ gửi AI tên sản phẩm (không có dữ liệu người mua, giá hay doanh thu).
 */
export async function POST(req: Request) {
  if (!sameOrigin(req.headers.get("origin"), req.headers.get("host"))) return json({ error: "Yêu cầu không hợp lệ" }, 403);
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  const workspaceId = await workspaceOf(supabase, auth.user.id, true);
  if (!workspaceId) return json({ error: "Bạn không có quyền sửa ngành hàng của workspace này" }, 403);
  if (limited(auth.user.id)) return json({ error: "Bạn chạy phân ngành quá nhanh, thử lại sau ít phút." }, 429);

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "Dữ liệu không hợp lệ" }, 400);
  const deps = chatRouterDeps();
  if (!deps) return json({ error: "Máy chủ chưa cấu hình AI." }, 503);

  const { platform, products } = body.data;
  const cfg = await loadFeeConfig(supabase, workspaceId);
  const type = sellerTypeOf(cfg.settings, platform);
  const caller = new ChatCaller(auth.user.id, deps);
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const r = await categorizeProducts({
          platform,
          type,
          items: products,
          ask: makeAsk(caller, platform),
          signal: req.signal,
          onProgress: (done, total) => send({ t: "progress", done, total }),
        });
        send({
          t: "done",
          results: [...r.assigned.entries()].map(([key, v]) => ({ key, path: v.path, ratePct: v.ratePct })),
          unassigned: r.unassigned,
          failedCalls: r.failedCalls,
        });
      } catch (e) {
        send({ t: "error", message: e instanceof FatalAskError ? e.message : "AI phân ngành gặp lỗi, thử lại sau.", ...(e instanceof FatalAskError && e.quota ? { quota: true } : {}) });
        if (!(e instanceof FatalAskError)) console.error("[api/fees/categorize]", e instanceof Error ? e.message : e);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
