import type { ChatMessage, ProviderOutcome, ProviderRequest } from "./types";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_TOOL_CALLS = 20;

export const groqModel = () => process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b";

const toGroqMessage = (m: ChatMessage) =>
  m.role === "assistant" && m.tool_calls?.length
    ? {
        role: "assistant",
        content: m.content,
        tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
      }
    : m;

/**
 * Gọi Groq (miễn phí, hạn mức 8.000 token/phút). Lỗi hạn mức/quá lớn/lỗi tạm thời đều `fallbackable` để chuyển sang
 * nhà cung cấp khác nếu có. Đọc SSE của Groq rồi đổi sang NDJSON: chữ chuyển tiếp ngay, lệnh công cụ gom đủ mới phát.
 */
export async function callGroq(apiKey: string, req: ProviderRequest): Promise<ProviderOutcome> {
  const upstream = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: groqModel(),
      stream: true,
      temperature: 0.3,
      reasoning_effort: "low",
      // Dịch vụ AI tính cả số token tối đa của câu trả lời vào hạn mức 8.000 token/phút: đừng xin dư.
      max_completion_tokens: 1200,
      ...(req.tools ? { tools: req.tools, tool_choice: "auto" } : {}),
      messages: [{ role: "system", content: req.system }, ...req.messages.map(toGroqMessage)],
    }),
    signal: req.signal,
  }).catch(() => null);

  const failure = (status: number, body: Record<string, unknown>): ProviderOutcome => ({
    ok: false, provider: "groq", status, body, fallbackable: true,
  });

  if (!upstream) return failure(502, { error: "Không kết nối được tới dịch vụ AI." });
  if (!upstream.ok || !upstream.body) {
    // Chỉ ghi trạng thái + thông điệp lỗi (không chứa khoá) để chẩn đoán hạn mức.
    const detail = await upstream.text().catch(() => "");
    console.error("[api/chat] Groq trả về", upstream.status, detail.slice(0, 300));
    if (upstream.status === 429) {
      // "Please try again in 14.97s" / "in 1m2.5s": cho client biết để tự chờ rồi thử lại.
      const m = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(detail);
      const retryAfter = m ? Math.ceil(Number(m[1] ?? 0) * 60 + Number(m[2])) : undefined;
      return failure(429, { error: "Dịch vụ AI đang quá tải hoặc hết hạn mức, thử lại sau.", retryAfter });
    }
    // Một yêu cầu đơn lẻ đã vượt hạn mức token/phút của model (Groq trả 413, khác 429): chờ cũng vô ích, cần gửi ít hơn.
    if (upstream.status === 413) {
      const m = /Limit (\d+), Requested (\d+)/i.exec(detail);
      return failure(413, {
        error: "Dữ liệu gửi kèm quá lớn so với hạn mức của dịch vụ AI. Hãy thử lại hoặc hỏi về một widget cụ thể.",
        tooLarge: true,
        ...(m ? { limit: Number(m[1]), requested: Number(m[2]) } : {}),
      });
    }
    // Model tạo lệnh sai định dạng (Groq trả 400): thường chỉ cần hỏi lại. Báo cho client để tự thử lại một lần.
    if (upstream.status === 400 && /tool_use_failed|failed to call a function|failed_generation/i.test(detail)) {
      return failure(502, { error: "AI tạo lệnh chưa đúng định dạng, hãy thử diễn đạt lại.", retry: true });
    }
    return failure(502, { error: "Dịch vụ AI gặp lỗi." });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const pending = new Map<number, { id: string; name: string; args: string }>();
  let buf = "";
  const emit = (c: TransformStreamDefaultController<Uint8Array>, obj: unknown) => c.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

  const handleLine = (line: string, c: TransformStreamDefaultController<Uint8Array>) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const delta = JSON.parse(data)?.choices?.[0]?.delta;
      if (typeof delta?.content === "string" && delta.content) emit(c, { t: "text", v: delta.content });
      for (const tc of delta?.tool_calls ?? []) {
        const i = Number(tc.index ?? 0);
        const cur = pending.get(i) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = String(tc.id);
        if (tc.function?.name) cur.name += String(tc.function.name);
        if (tc.function?.arguments) cur.args += String(tc.function.arguments);
        pending.set(i, cur);
      }
    } catch {
      /* bỏ qua dòng không phải JSON */
    }
  };

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) handleLine(line, c);
    },
    flush(c) {
      if (buf) handleLine(buf, c);
      [...pending.entries()]
        .sort((a, b) => a[0] - b[0])
        .slice(0, MAX_TOOL_CALLS)
        .forEach(([i, p]) => emit(c, { t: "tool", id: p.id || `call_${i}`, name: p.name, args: p.args }));
    },
  });

  return { ok: true, provider: "groq", stream: upstream.body.pipeThrough(stream) };
}
