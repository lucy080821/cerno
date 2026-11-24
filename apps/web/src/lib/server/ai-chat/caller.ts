import { costMicro } from "../ai/anthropic";
import { estimateUsage, routeChat, type RouterDeps } from "../ai/router";
import type { ProviderName, ProviderOutcome, ProviderRequest } from "../ai/types";

/**
 * Gọi AI nhiều lượt cho MỘT câu hỏi (vòng gọi công cụ) mà không tính nhiều lần hạn mức:
 * - Lượt đầu đi qua `routeChat` (chọn nhà cung cấp, giữ chỗ một lượt AI trả phí nếu dùng Claude).
 * - Các lượt sau gọi THẲNG đúng nhà cung cấp đã trả lời lượt đầu: không giữ chỗ thêm lượt (một câu hỏi = một lượt dù tra nhiều lần),
 *   nhưng chi phí token thật của từng lượt vẫn được ghi.
 * - Nhà cung cấp hiện tại lỗi tạm thời giữa chừng (hết hạn mức, quá tải) thì chuyển sang nhà cung cấp còn lại qua `routeChat`.
 */
export class ChatCaller {
  private pinned: ProviderName | null = null;

  constructor(
    private readonly userId: string,
    private readonly deps: RouterDeps,
  ) {}

  get provider(): ProviderName | null {
    return this.pinned;
  }

  async call(req: ProviderRequest): Promise<ProviderOutcome> {
    if (!this.pinned) {
      const out = await routeChat(this.userId, req, this.deps);
      if (out.ok) this.pinned = out.provider;
      return out;
    }
    const out = await this.direct(this.pinned, req);
    if (out.ok || !out.fallbackable) return out;
    const other: ProviderName = this.pinned === "groq" ? "anthropic" : "groq";
    const alt = await routeChat(this.userId, req, { ...this.deps, order: [other] });
    if (alt.ok) {
      this.pinned = alt.provider;
      return alt;
    }
    return out;
  }

  private async direct(provider: ProviderName, req: ProviderRequest): Promise<ProviderOutcome> {
    if (provider === "groq" && this.deps.groq) return this.deps.groq(req);
    if (provider === "anthropic" && this.deps.anthropic) {
      return this.deps.anthropic(req, (usage, model) => {
        const u = usage ?? estimateUsage(req);
        void this.deps.record(this.userId, u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), u.output_tokens, costMicro(model, u));
      });
    }
    return { ok: false, provider, status: 503, body: { error: "Chưa cấu hình dịch vụ AI trên server." }, fallbackable: false };
  }
}
