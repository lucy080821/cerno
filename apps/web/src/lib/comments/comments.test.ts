import { describe, expect, it } from "vitest";
import { buildThreads, timeAgo, type CommentRow } from "./comments";

const row = (id: string, at: string, parent: string | null = null): CommentRow => ({
  id, dashboard_id: "d", widget_id: null, parent_id: parent, author_id: "u", author_name: "A", body: id, created_at: at,
});

describe("buildThreads", () => {
  it("gốc mới nhất trước, trả lời cũ nhất trước", () => {
    const t = buildThreads([
      row("a", "2026-01-01T00:00:00Z"),
      row("b", "2026-01-02T00:00:00Z"),
      row("r2", "2026-01-04T00:00:00Z", "a"),
      row("r1", "2026-01-03T00:00:00Z", "a"),
    ]);
    expect(t.map((x) => x.root.id)).toEqual(["b", "a"]);
    expect(t[1].replies.map((x) => x.id)).toEqual(["r1", "r2"]);
  });
  it("bỏ trả lời mất bình luận gốc", () => {
    expect(buildThreads([row("r", "2026-01-01T00:00:00Z", "gone")])).toEqual([]);
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  it("định dạng khoảng thời gian", () => {
    expect(timeAgo("2026-01-01T11:59:50Z", now)).toBe("vừa xong");
    expect(timeAgo("2026-01-01T11:30:00Z", now)).toBe("30 phút trước");
    expect(timeAgo("2026-01-01T07:00:00Z", now)).toBe("5 giờ trước");
    expect(timeAgo("2025-12-30T12:00:00Z", now)).toBe("2 ngày trước");
  });
});
