import { describe, expect, it } from "vitest";
import { Dashboard } from "./dashboard";
import { DEFAULT_PAGE_ID, getPages, pageIdOf, resolvePageId, widgetsOnPage } from "./pages";
import { deriveMobileLayout } from "./mobileLayout";

const text = (id: string, y: number, pageId?: string) => ({
  id, x: 0, y, w: 200, h: 40, rotation: 0, z: 0, locked: false, hidden: false, pageId,
  config: { kind: "text" as const, text: id, fontSize: 16, bold: false, align: "left" as const },
});

const base = {
  schemaVersion: 1 as const, id: "d", name: "D",
  canvas: { width: 1000, height: 600, background: "#fff" },
};

describe("trang của dashboard", () => {
  it("dashboard cũ (không có pages/nav) vẫn hợp lệ và có đúng một trang mặc định", () => {
    const r = Dashboard.safeParse({ ...base, widgets: [text("a", 0)] });
    expect(r.success).toBe(true);
    const doc = Dashboard.parse({ ...base, widgets: [text("a", 0)] });
    expect(doc.pages).toEqual([]);
    expect(doc.nav.show).toBe(true);
    expect(doc.nav.transition).toBe("slide");
    expect(getPages(doc)).toEqual([{ id: DEFAULT_PAGE_ID, name: "Trang 1" }]);
    expect(widgetsOnPage(doc, DEFAULT_PAGE_ID).map((w) => w.id)).toEqual(["a"]);
  });

  it("widget không gán trang hoặc gán trang đã xoá thuộc trang đầu", () => {
    const doc = Dashboard.parse({
      ...base, pages: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }],
      widgets: [text("a", 0), text("b", 0, "p2"), text("c", 0, "da-xoa")],
    });
    expect(pageIdOf(doc, doc.widgets[0])).toBe("p1");
    expect(pageIdOf(doc, doc.widgets[1])).toBe("p2");
    expect(pageIdOf(doc, doc.widgets[2])).toBe("p1");
    expect(widgetsOnPage(doc, "p1").map((w) => w.id)).toEqual(["a", "c"]);
    expect(widgetsOnPage(doc, "p2").map((w) => w.id)).toEqual(["b"]);
  });

  it("resolvePageId rơi về trang đầu khi id không còn", () => {
    const doc = Dashboard.parse({ ...base, pages: [{ id: "p1", name: "A" }], widgets: [] });
    expect(resolvePageId(doc, "p1")).toBe("p1");
    expect(resolvePageId(doc, "khong-co")).toBe("p1");
    expect(resolvePageId(doc, undefined)).toBe("p1");
  });

  it("giới hạn 20 trang và kiểm tra kiểu của thanh điều hướng", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, name: `T${i}` }));
    expect(Dashboard.safeParse({ ...base, pages: many, widgets: [] }).success).toBe(false);
    expect(Dashboard.safeParse({ ...base, nav: { width: 50 }, widgets: [] }).success).toBe(false);
    expect(Dashboard.safeParse({ ...base, nav: { transition: "spin" }, widgets: [] }).success).toBe(false);
  });

  it("layout mobile theo từng trang", () => {
    const doc = Dashboard.parse({
      ...base, pages: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }],
      widgets: [text("a", 0), text("b", 50, "p2"), text("c", 100, "p1")],
    });
    expect(deriveMobileLayout(doc, 390, "p1").map((i) => i.widgetId)).toEqual(["a", "c"]);
    expect(deriveMobileLayout(doc, 390, "p2").map((i) => i.widgetId)).toEqual(["b"]);
    expect(deriveMobileLayout(doc).map((i) => i.widgetId)).toHaveLength(3);
  });
});
