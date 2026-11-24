import { describe, expect, it } from "vitest";
import type { Todo } from "./todos";
import { pendingCount, splitTodos } from "./todos-done";

const t = (id: string): Todo => ({ kind: "thin", priority: "medium", id, href: "/orders" });

describe("việc cần làm đã xong", () => {
  it("tách việc còn lại và việc đã xong, giữ thứ tự", () => {
    const { open, closed } = splitTodos([t("a"), t("b"), t("c")], ["b"]);
    expect(open.map((x) => x.id)).toEqual(["a", "c"]);
    expect(closed.map((x) => x.id)).toEqual(["b"]);
  });
  it("id đã xong không còn gợi ý thì bị bỏ qua", () => {
    expect(splitTodos([t("a")], ["zzz"]).open).toHaveLength(1);
    expect(pendingCount(["a", "b"], ["zzz"])).toBe(2);
  });
  it("huy hiệu chỉ đếm việc chưa xong", () => {
    expect(pendingCount(["a", "b", "c"], ["a", "c"])).toBe(1);
    expect(pendingCount(["a"], ["a"])).toBe(0);
    expect(pendingCount([], ["a"])).toBe(0);
  });
});
