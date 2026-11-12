import { NextResponse } from "next/server";
import { z, type ColumnInfo } from "@dashboard/schema";
import { getTemplateEntry } from "@/content/templates";
import { createClient } from "@/lib/supabase/server";
import { callAnthropic } from "@/lib/server/ai/anthropic";
import { callGroq } from "@/lib/server/ai/groq";
import { collectChat } from "@/lib/server/ai/collect";
import { QUOTA_MESSAGES, recordPaid, releasePaid, reservePaid } from "@/lib/server/ai/quota";
import { parseOrder, routeChat } from "@/lib/server/ai/router";
import { fetchSourceRows } from "@/lib/server/source-rows";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { MAP_TOOL, MATCH_SYSTEM, buildMatchPrompt, parseMatchResult, type ColumnForAi } from "@/lib/templates/ai-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limited = createRateLimiter(10, 60_000);

const Body = z.object({
  templateId: z.string().min(1).max(80),
  sourceId: z.string().uuid(),
  /** Khoá vai cần AI tìm (còn thiếu sau khi khớp bằng luật). */
  slots: z.array(z.string().max(60)).min(1).max(60),
  /** Cột đã được gán cho vai khác, không đưa cho AI. */
  taken: z.array(z.string().max(200)).max(200).default([]),
});

const COLUMN_TYPES = new Set(["string", "number", "date", "boolean"]);

/** Luôn trả 200 với `mapping` (có thể rỗng): AI lỗi thì giao diện vẫn cho người dùng tự chọn cột. */
const none = (reason: string) => NextResponse.json({ mapping: {}, ai: false, reason });

/**
 * Nhờ AI ghép các vai bắt buộc còn sót. Server tự lấy mẫu và cột (qua RLS), client chỉ gửi id; chỉ gửi AI
 * tên cột + kiểu + 3 giá trị mẫu mỗi cột.
 */
export async function POST(req: Request) {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  if (limited(user.id)) return NextResponse.json({ error: "Bạn thử quá nhanh, thử lại sau một phút." }, { status: 429 });

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Yêu cầu không hợp lệ." }, { status: 400 });
  const { templateId, sourceId, slots: wanted, taken } = body.data;

  const entry = getTemplateEntry(templateId);
  if (!entry) return NextResponse.json({ error: "Không có mẫu này." }, { status: 404 });
  const slots = entry.template.slots.filter((s) => wanted.includes(s.key));
  if (!slots.length) return NextResponse.json({ mapping: {}, ai: false });

  const groqKey = process.env.GROQ_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!groqKey && !anthropicKey) return none("Chưa cấu hình AI.");

  const supabase = await createClient();
  const { data: src } = await supabase.from("data_sources").select("columns").eq("id", sourceId).maybeSingle();
  if (!src) return NextResponse.json({ error: "Không tìm thấy nguồn dữ liệu." }, { status: 404 });
  const allCols: ColumnInfo[] = ((src.columns ?? []) as { name: string; type: string }[])
    .filter((c) => typeof c?.name === "string" && COLUMN_TYPES.has(c.type))
    .map((c) => ({ name: c.name, type: c.type as ColumnInfo["type"] }));
  const takenSet = new Set(taken);
  const free = allCols.filter((c) => !takenSet.has(c.name));
  if (!free.length) return none("Không còn cột trống.");

  const { rows } = await fetchSourceRows(supabase, sourceId, 3);
  const forAi: ColumnForAi[] = free.map((c) => ({
    ...c,
    samples: rows
      .map((r) => (r as Record<string, unknown> | null)?.[c.name])
      .filter((v) => v !== null && v !== undefined && v !== "")
      .map((v) => String(v)),
  }));

  const outcome = await routeChat(
    user.id,
    { system: MATCH_SYSTEM, messages: [{ role: "user", content: buildMatchPrompt(slots, forAi) }], tools: [MAP_TOOL], signal: req.signal },
    {
      groq: groqKey ? (r) => callGroq(groqKey, r) : undefined,
      anthropic: anthropicKey ? (r, onUsage) => callAnthropic(anthropicKey, r, onUsage) : undefined,
      order: parseOrder(process.env.AI_PROVIDER_ORDER),
      reserve: reservePaid,
      release: releasePaid,
      record: recordPaid,
      quotaMessages: QUOTA_MESSAGES,
    },
  );
  if (!outcome.ok) return none(typeof outcome.body.error === "string" ? outcome.body.error : "AI không phản hồi.");

  try {
    const got = await collectChat(outcome.stream);
    const call = got.tools.find((t) => t.name === MAP_TOOL.function.name);
    if (!call) return none("AI không đưa ra gợi ý.");
    return NextResponse.json({ mapping: parseMatchResult(call.args, slots, free), ai: true });
  } catch {
    return none("Kết nối AI bị gián đoạn.");
  }
}
