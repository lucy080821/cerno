/** Kiểu dùng chung cho các nhà cung cấp AI (Groq, Anthropic) của khung chat. */

export interface ToolCallIn {
  id: string;
  name: string;
  arguments: string;
}

/** Tin nhắn hội thoại theo dạng trung lập (giống định dạng OpenAI) mà client gửi lên; mỗi nhà cung cấp tự chuyển đổi. */
export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCallIn[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Định nghĩa công cụ dạng function calling của OpenAI (xem lib/editor/ai-tools.ts). */
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ProviderName = "groq" | "anthropic";

export interface ProviderRequest {
  system: string;
  messages: ChatMessage[];
  /** null = không gửi công cụ. */
  tools: ToolDef[] | null;
  signal?: AbortSignal;
}

/**
 * Kết quả gọi một nhà cung cấp. Thành công: luồng NDJSON `{"t":"text","v"}` / `{"t":"tool","id","name","args"}`.
 * Thất bại: mã HTTP + nội dung lỗi trả cho client, và `fallbackable` cho biết có nên thử nhà cung cấp kế tiếp không
 * (hết hạn mức/quá lớn/lỗi tạm thời của nhà này thì thử nhà khác; lỗi do chính yêu cầu thì không).
 */
export type ProviderOutcome =
  | { ok: true; provider: ProviderName; stream: ReadableStream<Uint8Array> }
  | { ok: false; provider: ProviderName; status: number; body: Record<string, unknown>; fallbackable: boolean };
