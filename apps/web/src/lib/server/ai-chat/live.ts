import type { SupabaseClient } from "@supabase/supabase-js";
import { callAnthropic } from "../ai/anthropic";
import { callGroq } from "../ai/groq";
import { QUOTA_MESSAGES, recordPaid, releasePaid, reservePaid } from "../ai/quota";
import { parseOrder, type RouterDeps } from "../ai/router";
import { loadFeeConfig } from "../fees";
import { computeProfitRange } from "../profit";
import { executeQuery } from "../query-service";
import { getSourceMeta } from "../row-cache";
import type { ToolDeps } from "./tools";

/** Nhà cung cấp AI + hạn mức cho trang Hỏi AI. Thứ tự riêng (AI_CHAT_ORDER, mặc định Claude trước): vòng tra cứu nhiều lượt và báo cáo dài không hợp với hạn mức 8.000 token/phút của Groq miễn phí. */
export function chatRouterDeps(): RouterDeps | null {
  const groqKey = process.env.GROQ_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!groqKey && !anthropicKey) return null;
  return {
    groq: groqKey ? (r) => callGroq(groqKey, r) : undefined,
    anthropic: anthropicKey ? (r, onUsage) => callAnthropic(anthropicKey, r, onUsage) : undefined,
    order: parseOrder(process.env.AI_CHAT_ORDER ?? "anthropic,groq"),
    reserve: reservePaid,
    release: releasePaid,
    record: recordPaid,
    quotaMessages: QUOTA_MESSAGES,
  };
}

/** Công cụ dữ liệu thật. Quyền đọc từng nguồn đã được kiểm bằng RLS lúc nạp danh sách nguồn (`loadSources`), nên ở đây chỉ nhận id đã qua kiểm tra. */
export function liveToolDeps(db: SupabaseClient): ToolDeps {
  return {
    query: async (sourceId, spec) => {
      const meta = await getSourceMeta(sourceId);
      if (!meta) throw new Error("source_missing");
      return executeQuery(sourceId, meta, spec);
    },
    profit: async (source, range) => {
      const fees = await loadFeeConfig(db, source.workspaceId);
      const r = await computeProfitRange(source.id, fees, range);
      return { orders: r.orders, summary: r.summary, dataMin: r.fullSummary.dateMin, dataMax: r.fullSummary.dateMax };
    },
  };
}
