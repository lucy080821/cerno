import { parseEvent, splitLines, type Msg } from "./client";
import type { Visual } from "./visual";

/**
 * Gửi một câu hỏi tới /api/ai/chat và đọc luồng NDJSON trả về, chuyển từng sự kiện cho `on`. Mọi cách thất bại (HTTP lỗi, AI báo lỗi,
 * mất kết nối giữa chừng, người dùng bấm dừng) đều kết thúc bằng ĐÚNG MỘT lần `onError`; thành công kết thúc bằng một lần `onDone`.
 */
export interface StreamRequest {
  chatId: string | null;
  question: string;
  sourceIds: string[];
  lang: "vi" | "en";
  /** Mô tả trang đang xem, chỉ là gợi ý ngữ cảnh cho AI. */
  context?: string;
}

export interface StreamHandlers {
  onChat(id: string, title: string): void;
  onStatus(text: string): void;
  onText(chunk: string): void;
  /** Vòng vừa rồi hoá ra là vòng gọi công cụ: bỏ chữ dẫn đã phát. */
  onReset(): void;
  onVisual(v: Visual): void;
  onDone(message: Msg): void;
  /** `quota` = hết lượt/ngân sách AI: giao diện hiện nút liên hệ nâng cấp. */
  onError(message: string, quota?: boolean): void;
}

export async function streamAnswer(req: StreamRequest, on: StreamHandlers, signal: AbortSignal): Promise<void> {
  let finished = false;
  try {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: req.chatId, question: req.question, sourceIds: req.sourceIds, lang: req.lang, ...(req.context ? { context: req.context } : {}) }),
      signal,
    });
    if (!res.ok || !res.body) {
      const j = (await res.json().catch(() => null)) as { error?: string; quota?: string } | null;
      return on.onError(j?.error ?? "Không gọi được AI, hãy thử lại.", typeof j?.quota === "string");
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const parts = splitLines(rest, dec.decode(value, { stream: true }));
      rest = parts.rest;
      for (const line of parts.lines) {
        const ev = parseEvent(line);
        if (!ev || finished) continue;
        switch (ev.t) {
          case "chat": on.onChat(ev.id, ev.title); break;
          case "status": on.onStatus(ev.v); break;
          case "text": on.onText(ev.v); break;
          case "reset": on.onReset(); break;
          case "visual": on.onVisual(ev.visual); break;
          case "done": finished = true; on.onDone(ev.message); break;
          case "error": finished = true; on.onError(ev.message, ev.quota === true); break;
        }
      }
    }
    if (!finished) on.onError("Kết nối bị gián đoạn trước khi AI trả lời xong, hãy thử lại.");
  } catch (e) {
    if (finished) return;
    on.onError((e as { name?: string }).name === "AbortError" ? "Đã dừng." : "Mất kết nối tới máy chủ, hãy thử lại.");
  }
}
