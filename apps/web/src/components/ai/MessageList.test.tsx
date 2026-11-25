import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList } from "./MessageList";

const base = { messages: [], live: null, copiedId: null, onCopy: () => {}, onRetry: () => {}, endRef: { current: null } };

describe("lỗi trong khung chat", () => {
  it("hết lượt AI: nêu thông báo và có nút liên hệ nâng cấp tới /upgrade", () => {
    const html = renderToStaticMarkup(<MessageList {...base} error={{ message: "Đã hết lượt dùng Claude (Haiku 5.5) hôm nay.", question: "q", quota: true }} />);
    expect(html).toContain("Đã hết lượt dùng Claude (Haiku 5.5) hôm nay.");
    expect(html).toContain('href="/upgrade"');
    expect(html).toContain("Liên hệ nâng cấp");
    expect(html).toContain("Hỏi lại");
  });
  it("lỗi thường: không có nút nâng cấp", () => {
    const html = renderToStaticMarkup(<MessageList {...base} error={{ message: "AI gặp lỗi", question: "q" }} />);
    expect(html).not.toContain("/upgrade");
  });
});
