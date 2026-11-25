import { NextResponse } from "next/server";
import { z } from "@dashboard/schema";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { collectChat } from "@/lib/server/ai/collect";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { computeAlert, summarize } from "@/lib/server/alerts/compute";
import { ASK_TOOL, MAX_REQUEST_CHARS, PARSE_SYSTEM_STORE, PROPOSE_TOOL, buildParseMessage, interpretParse, type SourceForParse } from "@/lib/server/alerts/parse-ai";
import { liveChat } from "@/lib/server/reports/live";
import { aiParseViolation } from "@/lib/plan";
import { planForWorkspace, releaseAiParse, reserveAiParse } from "@/lib/server/plan";
import { membershipOf } from "@/lib/server/profit";
import { NOTIFY_CALC } from "@/lib/profit/notify-metrics";
import { loadWorkspaceAlertCtx } from "@/lib/server/workspace-notify/context";
import { enrichedOrderRows } from "@/lib/server/workspace-notify/exec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limited = createRateLimiter(5, 60_000);
const Body = z.object({ text: z.string().trim().min(3).max(MAX_REQUEST_CHARS) });
const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/** "Tạo bằng AI" cho cảnh báo theo cửa hàng: giống bản theo dashboard nhưng đọc cột của bảng đơn hàng đa kênh (kèm cột Lãi). */
export async function POST(req: Request) {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  const m = await membershipOf(supabase, auth.user.id);
  if (!m) return fail("Bạn chưa thuộc cửa hàng nào", 403);
  if (limited(auth.user.id)) return fail("Bạn thao tác quá nhanh, thử lại sau một phút.", 429);

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return fail("Hãy mô tả điều bạn muốn được báo (3–500 ký tự).", 400);

  const ac = await loadWorkspaceAlertCtx(m.workspaceId);
  if (!ac) return fail("Cửa hàng chưa có dữ liệu đơn hàng để đặt cảnh báo.", 409);

  // Vài giá trị mẫu mỗi cột (không gửi dữ liệu người mua: bảng đơn hàng không có các cột đó).
  const rows = (await enrichedOrderRows(m.workspaceId, ac.ordersSourceId)).slice(0, 300);
  const forAi: SourceForParse[] = [{
    id: ac.ordersSourceId,
    name: "Đơn hàng đa kênh",
    columns: ac.sources[0].columns.map((col) => ({
      name: col.name,
      type: col.type,
      samples: rows.map((r) => r[col.name]).filter((v) => v !== null && v !== undefined && v !== "").slice(0, 3).map((v) => String(v)),
    })),
  }];

  const plan = await planForWorkspace(m.workspaceId);
  if (!(await reserveAiParse(auth.user.id, plan))) {
    const v = aiParseViolation(plan);
    return fail(v.message, 403, { code: v.code });
  }

  const outcome = await liveChat(ac.ownerId)({
    system: PARSE_SYSTEM_STORE,
    messages: [{ role: "user", content: buildParseMessage(body.data.text, forAi, NOTIFY_CALC.map((c) => ({ name: c.name, sourceId: ac.ordersSourceId, expression: c.expression }))) }],
    tools: [PROPOSE_TOOL, ASK_TOOL],
  });
  if (!outcome.ok) {
    await releaseAiParse(auth.user.id, plan);
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

  let summary = null;
  if (result.draft.condition.type !== "stale") {
    try {
      summary = summarize(await computeAlert(result.draft.metric, result.draft.condition, { exec: ac.exec!, calc: ac.calcDefs(result.draft.metric.sourceId), now: new Date() }));
    } catch {
      /* không tính được giá trị hiện tại: vẫn hiện bản nháp */
    }
  }
  return NextResponse.json({ ai: true, draft: { name: result.name, metric: result.draft.metric, condition: result.draft.condition, source_prompt: body.data.text }, summary });
}
