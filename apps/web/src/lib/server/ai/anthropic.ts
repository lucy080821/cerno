import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ProviderOutcome, ProviderRequest, ToolDef } from "./types";

/**
 * Anthropic (Claude) làm nhà cung cấp AI trả phí, dùng khi Groq miễn phí hết hạn mức hoặc yêu cầu quá lớn.
 * Mặc định Claude Haiku 5.5 (rẻ nhất, đủ cho phân tích dữ liệu và gọi công cụ); đổi bằng ANTHROPIC_CHAT_MODEL.
 */

export const anthropicModel = () => process.env.ANTHROPIC_CHAT_MODEL || "claude-haiku-5-5";

/** Giá (USD mỗi 1 triệu token) = micro-USD mỗi token. Cập nhật khi Anthropic đổi giá hoặc khi đổi model. */
export const PRICING: Record<string, { in: number; out: number }> = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-opus-5-5": { in: 4, out: 20 },
};
/** Model lạ (người dùng đặt tên khác) thì tính theo giá cao nhất để không đánh giá thấp chi phí. */
const FALLBACK_PRICE = { in: 10, out: 50 };

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Chi phí của một lượt gọi, đơn vị micro-USD. Ghi cache đắt hơn 25%, đọc cache rẻ hơn 90%. */
export function costMicro(model: string, u: AnthropicUsage): number {
  const p = PRICING[model] ?? FALLBACK_PRICE;
  const cost =
    u.input_tokens * p.in +
    (u.cache_creation_input_tokens ?? 0) * p.in * 1.25 +
    (u.cache_read_input_tokens ?? 0) * p.in * 0.1 +
    u.output_tokens * p.out;
  return Math.ceil(cost);
}

const parseInput = (s: string): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(s || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/**
 * Đổi hội thoại trung lập (kiểu OpenAI) sang định dạng của Anthropic: lệnh công cụ của model thành khối `tool_use`,
 * kết quả công cụ liên tiếp gộp vào MỘT tin `user` gồm các khối `tool_result` (API yêu cầu như vậy).
 */
export function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  const pushUser = (blocks: Anthropic.ContentBlockParam[]) => {
    const last = out[out.length - 1];
    if (last?.role === "user" && Array.isArray(last.content)) last.content.push(...blocks);
    else out.push({ role: "user", content: blocks });
  };
  for (const m of messages) {
    if (m.role === "user") {
      pushUser([{ type: "text", text: m.content }]);
    } else if (m.role === "tool") {
      pushUser([{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content, is_error: /^LỖI/.test(m.content) }]);
    } else {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content.trim()) blocks.push({ type: "text", text: m.content });
      for (const c of m.tool_calls ?? []) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: parseInput(c.arguments) });
      if (blocks.length) out.push({ role: "assistant", content: blocks });
    }
  }
  return out;
}

export function toAnthropicTools(tools: ToolDef[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as Anthropic.Tool["input_schema"],
  }));
}

/** Đổi lỗi của SDK thành mã HTTP + thông báo cho client. Lỗi hạn mức/quá tải/hết số dư thì cho phép thử nhà cung cấp khác. */
export function mapAnthropicError(e: unknown): Extract<ProviderOutcome, { ok: false }> {
  const out = (status: number, error: string, fallbackable: boolean, extra: Record<string, unknown> = {}) =>
    ({ ok: false, provider: "anthropic", status, body: { error, ...extra }, fallbackable }) as const;

  if (e instanceof Anthropic.APIError) {
    const status = e.status ?? 0;
    const detail = String(e.message ?? "").slice(0, 300);
    console.error("[api/chat] Anthropic trả về", status, detail);
    if (status === 429) {
      const ra = Number(e.headers?.get?.("retry-after"));
      return out(429, "AI nâng cao đang quá tải, thử lại sau.", true, Number.isFinite(ra) && ra > 0 ? { retryAfter: Math.ceil(ra) } : {});
    }
    if (status === 401 || status === 403) return out(503, "Chưa cấu hình khoá Anthropic hợp lệ.", true);
    if (status === 400 && /credit balance|billing/i.test(detail)) return out(503, "AI nâng cao tạm hết số dư, thử lại sau.", true);
    if (status === 400) return out(502, "AI nâng cao từ chối yêu cầu này.", false);
    return out(502, "Dịch vụ AI nâng cao đang bận, thử lại sau.", true);
  }
  console.error("[api/chat] Anthropic lỗi kết nối:", e instanceof Error ? e.message : e);
  return out(502, "Không kết nối được tới dịch vụ AI nâng cao.", true);
}

/**
 * Gọi Claude (streaming) và trả về cùng định dạng NDJSON như Groq. Chờ sự kiện đầu tiên trước khi trả về để lỗi HTTP
 * (hạn mức, khoá sai, hết số dư) được báo đúng mã thay vì thành một luồng rỗng. `onUsage` được gọi khi xong với số token
 * thực tế (null nếu bị gián đoạn) để ghi chi phí.
 */
export async function callAnthropic(
  apiKey: string,
  req: ProviderRequest,
  onUsage: (usage: AnthropicUsage | null, model: string) => void,
): Promise<ProviderOutcome> {
  const model = anthropicModel();
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const stream = client.messages.stream(
    {
      model,
      max_tokens: 2000,
      system: req.system,
      messages: toAnthropicMessages(req.messages),
      ...(req.tools?.length ? { tools: toAnthropicTools(req.tools) } : {}),
      // Trả lời nhanh và rẻ: không suy nghĩ dài (token suy nghĩ cũng tính tiền) và không phải giữ lại khối suy nghĩ giữa các vòng gọi công cụ.
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
    },
    { signal: req.signal },
  );

  const it = stream[Symbol.asyncIterator]();
  let first: IteratorResult<Anthropic.MessageStreamEvent>;
  try {
    first = await it.next();
  } catch (e) {
    return mapAnthropicError(e);
  }

  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const handle = (ev: Anthropic.MessageStreamEvent) => {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) emit({ t: "text", v: ev.delta.text });
      };
      let usage: AnthropicUsage | null = null;
      try {
        if (!first.done) handle(first.value);
        for (;;) {
          const n = await it.next();
          if (n.done) break;
          handle(n.value);
        }
        const final = await stream.finalMessage();
        usage = final.usage;
        for (const block of final.content) {
          if (block.type === "tool_use") emit({ t: "tool", id: block.id, name: block.name, args: JSON.stringify(block.input ?? {}) });
        }
        if (final.stop_reason === "refusal") emit({ t: "text", v: "AI từ chối trả lời yêu cầu này." });
      } catch (e) {
        console.error("[api/chat] Anthropic gián đoạn giữa chừng:", e instanceof Error ? e.message : e);
        emit({ t: "text", v: "\n\n(Kết nối tới AI bị gián đoạn, hãy thử lại.)" });
      } finally {
        onUsage(usage, model);
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });
  return { ok: true, provider: "anthropic", stream: body };
}
