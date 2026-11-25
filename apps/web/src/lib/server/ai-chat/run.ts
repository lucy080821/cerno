import type { ChatMessage, ProviderName, ProviderOutcome, ProviderRequest } from "../ai/types";
import type { ChatCaller } from "./caller";
import { stripMarkdown } from "./plain";
import { buildSystemPrompt } from "./prompt";
import type { SourceInfo } from "./sources";
import { MAX_VISUALS, type Visual } from "@/lib/ai-chat/visual";
import { runTool, toolDefs, type ToolDeps } from "./tools";
import { VISUAL_TOOL_NAMES, wantsVisual } from "./visual";

/**
 * Chạy MỘT câu hỏi của người dùng: AI tra số liệu bằng công cụ (nhiều vòng) rồi viết báo cáo. Phát ra các sự kiện để route đẩy về trình duyệt:
 * - text: chữ đang được viết; reset: vòng vừa rồi hoá ra là vòng gọi công cụ nên bỏ chữ đã phát (thường chỉ là câu dẫn "để tôi tra cứu...");
 * - status: dòng trạng thái khi đang tra cứu; visual: biểu đồ/thẻ KPI hiện ngay trong tin trả lời (chỉ khi người dùng yêu cầu);
 *   final: câu trả lời cuối đã bỏ markdown; error: không trả lời được.
 * Phụ thuộc bên ngoài (nhà cung cấp AI, công cụ dữ liệu) được tiêm vào nên kiểm thử được mà không cần mạng.
 */
export type RunEvent =
  | { t: "text"; v: string }
  | { t: "reset" }
  | { t: "status"; v: string }
  | { t: "visual"; visual: Visual }
  | { t: "final"; text: string; meta: { provider: ProviderName | null; tools: string[]; rounds: number; visuals?: Visual[] } }
  | { t: "error"; message: string; status?: number; retryAfter?: number; quota?: string };

/** Số vòng tối đa (vòng cuối luôn KHÔNG có công cụ để buộc AI viết kết luận), số lệnh công cụ tối đa mỗi vòng và cả câu hỏi. */
export const MAX_ROUNDS = 7;
const MAX_CALLS_PER_ROUND = 6;
const MAX_CALLS_TOTAL = 14;
/** Báo cáo chi tiết cần nhiều chữ hơn khung chat trong editor (mặc định 1.200 token là quá ngắn). */
const MAX_TOKENS = 4000;

type Streamed = { t: "text"; v: string } | { t: "tool"; id: string; name: string; args: string };

/** Đọc luồng NDJSON của nhà cung cấp AI từng sự kiện một (chữ được chuyển tiếp ngay, không đợi hết luồng). */
async function* readEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<Streamed> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const parse = (line: string): Streamed | null => {
    if (!line.trim()) return null;
    try {
      const e = JSON.parse(line) as Record<string, unknown>;
      if (e.t === "text" && typeof e.v === "string") return { t: "text", v: e.v };
      if (e.t === "tool" && typeof e.name === "string") return { t: "tool", id: String(e.id ?? ""), name: e.name, args: typeof e.args === "string" ? e.args : "{}" };
    } catch {
      /* dòng hỏng: bỏ qua */
    }
    return null;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const ev = parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (ev) yield ev;
      }
    }
    const last = parse(buf + dec.decode());
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

const failureOf = (out: Extract<ProviderOutcome, { ok: false }>): RunEvent => ({
  t: "error",
  message: typeof out.body.error === "string" ? out.body.error : "Dịch vụ AI gặp lỗi, thử lại sau.",
  status: out.status,
  ...(typeof out.body.retryAfter === "number" ? { retryAfter: out.body.retryAfter } : {}),
  ...(typeof out.body.quota === "string" ? { quota: out.body.quota } : {}),
});

export async function* runChat(
  input: { history: ChatMessage[]; question: string; sources: SourceInfo[]; lang: "vi" | "en"; pageContext?: string; now?: Date; signal?: AbortSignal },
  deps: { caller: ChatCaller; tools: ToolDeps },
): AsyncGenerator<RunEvent> {
  // Hai công cụ vẽ hình và lời nhắc đi kèm chỉ được gửi khi câu hỏi hiện tại đòi hình: lượt phân tích thường không tốn thêm token.
  const visualOn = input.sources.length > 0 && wantsVisual(input.question);
  const system = buildSystemPrompt({ sources: input.sources, lang: input.lang, now: input.now, pageContext: input.pageContext, visual: visualOn });
  const defs = toolDefs(input.sources, { visual: visualOn });
  const toolDeps: ToolDeps = { ...deps.tools, lang: input.lang };
  const visuals: Visual[] = [];
  const messages: ChatMessage[] = [...input.history, { role: "user", content: input.question }];
  const used = new Set<string>();
  let totalCalls = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const allowTools = defs.length > 0 && round < MAX_ROUNDS && totalCalls < MAX_CALLS_TOTAL;
    const req: ProviderRequest = { system, messages, tools: allowTools ? defs : null, signal: input.signal, maxTokens: MAX_TOKENS, effort: "medium" };
    const out = await deps.caller.call(req);
    if (!out.ok) {
      yield failureOf(out);
      return;
    }

    let text = "";
    const calls: { id: string; name: string; args: string }[] = [];
    try {
      for await (const ev of readEvents(out.stream)) {
        if (ev.t === "text") {
          text += ev.v;
          yield { t: "text", v: ev.v };
        } else calls.push({ id: ev.id || `call_${round}_${calls.length}`, name: ev.name, args: ev.args });
      }
    } catch {
      yield { t: "error", message: "Kết nối tới AI bị gián đoạn, hãy thử lại." };
      return;
    }

    if (calls.length === 0 || !allowTools) {
      const final = stripMarkdown(text);
      if (!final) {
        yield { t: "error", message: "AI chưa viết được câu trả lời, hãy thử lại hoặc hỏi rõ hơn." };
        return;
      }
      yield { t: "final", text: final, meta: { provider: deps.caller.provider, tools: [...used], rounds: round, ...(visuals.length ? { visuals } : {}) } };
      return;
    }

    // Vòng gọi công cụ: bỏ chữ dẫn đã phát, chạy các lệnh, trả kết quả cho AI rồi sang vòng sau.
    yield { t: "reset" };
    messages.push({ role: "assistant", content: text, tool_calls: calls.map((c) => ({ id: c.id, name: c.name, arguments: c.args })) });
    const results = await Promise.all(
      calls.map(async (c, i) => {
        if (i >= MAX_CALLS_PER_ROUND || totalCalls + i >= MAX_CALLS_TOTAL) {
          return { c, res: { ok: false, content: "LỖI: Quá nhiều lệnh trong một lượt. Hãy gộp lại hoặc tra từng bước.", status: "" } };
        }
        if (VISUAL_TOOL_NAMES.has(c.name) && (!visualOn || visuals.length >= MAX_VISUALS)) {
          return { c, res: { ok: false, content: visualOn ? `LỖI: Đã đủ ${MAX_VISUALS} hình cho câu trả lời này.` : "LỖI: Người dùng không yêu cầu biểu đồ hay thẻ KPI ở câu hỏi này; hãy trả lời bằng chữ.", status: "" } };
        }
        return { c, res: await runTool(c.name, c.args, input.sources, toolDeps) };
      }),
    );
    totalCalls += calls.length;
    for (const { c, res } of results) {
      used.add(c.name);
      if (res.status) yield { t: "status", v: res.status };
      if (res.ok && res.visual && visuals.length < MAX_VISUALS) {
        visuals.push(res.visual);
        yield { t: "visual", visual: res.visual };
      }
      messages.push({ role: "tool", tool_call_id: c.id, content: res.content });
    }
  }
  yield { t: "error", message: "AI tra cứu quá nhiều bước mà chưa kết luận được, hãy hỏi ngắn gọn hơn." };
}
