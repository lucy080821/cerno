import { NextResponse } from "next/server";
import { z } from "@dashboard/schema";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/server/session-user";
import { collectChat } from "@/lib/server/ai/collect";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { fetchSourceRows } from "@/lib/server/source-rows";
import { loadAlertContext } from "@/lib/server/alerts/context";
import { computeAlert, summarize } from "@/lib/server/alerts/compute";
import {
  ASK_TOOL, MAX_REQUEST_CHARS, PARSE_SYSTEM, PROPOSE_TOOL, buildParseMessage, interpretParse, type SourceForParse,
} from "@/lib/server/alerts/parse-ai";
import { liveChat, liveExec } from "@/lib/server/reports/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string }> };

const limited = createRateLimiter(5, 60_000);
const Body = z.object({ text: z.string().trim().min(3).max(MAX_REQUEST_CHARS) });

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/**
 * "Tạo bằng AI": nhận câu người dùng gõ, trả bản NHÁP của luật (chưa lưu) để hiện thành biểu mẫu cho người dùng xác nhận/sửa,
 * kèm "giá trị hiện tại → bây giờ có báo không". Hoặc trả một câu hỏi lại khi AI không chắc. AI lỗi thì trả `ai: false`
 * và giao diện cho người dùng tự cài (tính năng vẫn dùng được, chỉ thiếu phần AI).
 */
export async function POST(req: Request, ctx: Params) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return fail("ID không hợp lệ", 400);
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  const { data: role } = await supabase.rpc("dashboard_role", { d: id });
  if (!role) return fail("Bạn không có quyền với dashboard này", 403);
  if (limited(auth.user.id)) return fail("Bạn thao tác quá nhanh, thử lại sau một phút.", 429);

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return fail("Hãy mô tả điều bạn muốn được báo (3–500 ký tự).", 400);

  let ac;
  try {
    ac = await loadAlertContext(id);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Không đọc được dashboard", 500);
  }
  if (!ac) return fail("Không tìm thấy dashboard", 404);
  if (!ac.sources.length) return fail("Dashboard chưa có nguồn Google Sheets nào để đặt cảnh báo.", 400);

  // 3 giá trị mẫu mỗi cột (đọc bằng service role: đã kiểm quyền ở trên và nguồn thuộc đúng workspace của dashboard).
  const admin = createAdminClient();
  const forAi: SourceForParse[] = [];
  for (const s of ac.sources) {
    const { rows } = await fetchSourceRows(admin, s.id, 3);
    forAi.push({
      id: s.id,
      name: s.name,
      columns: s.columns.map((col) => ({
        name: col.name,
        type: col.type,
        samples: rows
          .map((r) => (r as Record<string, unknown> | null)?.[col.name])
          .filter((v) => v !== null && v !== undefined && v !== "")
          .map((v) => String(v)),
      })),
    });
  }

  const chat = liveChat(ac.ownerId);
  const outcome = await chat({
    system: PARSE_SYSTEM,
    messages: [{ role: "user", content: buildParseMessage(body.data.text, forAi, ac.calcFields.map((c) => ({ name: c.name, sourceId: c.sourceId, expression: c.expression }))) }],
    tools: [PROPOSE_TOOL, ASK_TOOL],
  });
  if (!outcome.ok) {
    return NextResponse.json({ ai: false, error: typeof outcome.body.error === "string" ? outcome.body.error : "AI không phản hồi." });
  }
  let result;
  try {
    result = interpretParse(await collectChat(outcome.stream), ac.sources, ac.calc);
  } catch {
    return NextResponse.json({ ai: false, error: "Kết nối AI bị gián đoạn." });
  }

  if (result.kind === "question") return NextResponse.json({ ai: true, question: result.question });
  if (result.kind === "invalid") return NextResponse.json({ ai: true, invalid: true, errors: result.errors });

  // Bản nháp hợp lệ: tính luôn giá trị hiện tại để người dùng thấy "bây giờ có báo không".
  let summary = null;
  if (result.draft.condition.type !== "stale") {
    try {
      summary = summarize(
        await computeAlert(result.draft.metric, result.draft.condition, { exec: liveExec, calc: ac.calcDefs(result.draft.metric.sourceId), now: new Date() }),
      );
    } catch {
      /* không tính được giá trị hiện tại: vẫn hiện bản nháp */
    }
  }
  return NextResponse.json({ ai: true, draft: { name: result.name, metric: result.draft.metric, condition: result.draft.condition, source_prompt: body.data.text }, summary });
}
