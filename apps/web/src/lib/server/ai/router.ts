import { costMicro, type AnthropicUsage } from "./anthropic";
import type { ProviderName, ProviderOutcome, ProviderRequest } from "./types";

/**
 * Chọn nhà cung cấp AI cho một yêu cầu chat: thử lần lượt theo thứ tự (mặc định Groq miễn phí trước, Anthropic trả phí sau).
 * Nhà cung cấp trả phí chỉ chạy khi người dùng còn hạn mức và hệ thống còn ngân sách; nếu đã dùng thì ghi chi phí thực tế.
 * Tách khỏi route và nhận phụ thuộc từ ngoài để kiểm thử được mà không cần mạng/DB.
 */
export type ReserveResult = "ok" | "daily" | "monthly" | "budget" | "error";

export interface RouterDeps {
  /** Không có = chưa cấu hình nhà cung cấp này. */
  groq?: (req: ProviderRequest) => Promise<ProviderOutcome>;
  anthropic?: (req: ProviderRequest, onUsage: (usage: AnthropicUsage | null, model: string) => void) => Promise<ProviderOutcome>;
  order: ProviderName[];
  reserve: (userId: string) => Promise<ReserveResult>;
  release: (userId: string) => Promise<void>;
  record: (userId: string, inputTokens: number, outputTokens: number, costMicro: number) => Promise<void>;
  quotaMessages: Record<Exclude<ReserveResult, "ok">, string>;
}

/** Thứ tự nhà cung cấp từ biến AI_PROVIDER_ORDER (ví dụ "groq,anthropic"); bỏ giá trị lạ và trùng. */
export function parseOrder(raw: string | undefined): ProviderName[] {
  const out: ProviderName[] = [];
  for (const p of (raw ?? "groq,anthropic").split(",").map((x) => x.trim().toLowerCase())) {
    if ((p === "groq" || p === "anthropic") && !out.includes(p)) out.push(p);
  }
  return out.length ? out : ["groq", "anthropic"];
}

/** Ước lượng token khi cuộc gọi bị ngắt giữa chừng nên không có số liệu thật (nghiêng về nhiều để không đánh giá thấp chi phí). */
export function estimateUsage(req: ProviderRequest): AnthropicUsage {
  const chars = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0) + (req.tools ? 3000 : 0);
  return { input_tokens: Math.ceil(chars / 2.4), output_tokens: 300 };
}

export async function routeChat(userId: string, req: ProviderRequest, deps: RouterDeps): Promise<ProviderOutcome> {
  let failure: Extract<ProviderOutcome, { ok: false }> | null = null;
  let denied: Exclude<ReserveResult, "ok"> | null = null;

  for (const provider of deps.order) {
    if (provider === "groq" && deps.groq) {
      const out = await deps.groq(req);
      if (out.ok) return out;
      failure = out;
      if (!out.fallbackable) break;
    } else if (provider === "anthropic" && deps.anthropic) {
      const reserved = await deps.reserve(userId);
      if (reserved !== "ok") {
        denied = reserved;
        continue;
      }
      const out = await deps.anthropic(req, (usage, model) => {
        const u = usage ?? estimateUsage(req);
        void deps.record(userId, u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), u.output_tokens, costMicro(model, u));
      });
      if (out.ok) return out;
      // Thất bại trước khi sinh được gì: không tính lượt của người dùng.
      await deps.release(userId);
      failure = out;
      if (!out.fallbackable) break;
    }
  }

  if (failure) {
    // Báo thêm lý do AI nâng cao không được dùng làm đường lui (hết lượt/ngân sách), để người dùng hiểu vì sao phải chờ.
    if (denied && denied !== "error" && typeof failure.body.error === "string") {
      return { ...failure, body: { ...failure.body, error: `${failure.body.error} (${deps.quotaMessages[denied]})`, quota: denied } };
    }
    return failure;
  }
  if (denied) {
    return { ok: false, provider: "anthropic", status: 429, body: { error: deps.quotaMessages[denied], quota: denied }, fallbackable: false };
  }
  return { ok: false, provider: "groq", status: 503, body: { error: "Chưa cấu hình dịch vụ AI trên server." }, fallbackable: false };
}
