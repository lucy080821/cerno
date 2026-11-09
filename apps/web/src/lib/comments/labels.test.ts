import { describe, expect, it } from "vitest";
import type { Widget } from "@dashboard/schema";
import { widgetLabels } from "./labels";

const w = (id: string, config: Record<string, unknown>, pageId?: string) =>
  ({ id, x: 0, y: 0, w: 1, h: 1, rotation: 0, z: 0, locked: false, hidden: false, pageId, config }) as unknown as Widget;

describe("widgetLabels", () => {
  it("dùng tiêu đề, không có thì đánh số theo loại", () => {
    const m = widgetLabels({
      pages: [],
      widgets: [
        w("a", { kind: "chart", chartType: "bar", title: "Doanh thu" }),
        w("b", { kind: "chart", chartType: "bar" }),
        w("c", { kind: "chart", chartType: "bar" }),
        w("d", { kind: "text", text: "Ghi chú quan trọng" }),
        w("e", { kind: "kpi" }),
      ],
    });
    expect(m.get("a")).toBe("Biểu đồ cột: Doanh thu");
    expect(m.get("b")).toBe("Biểu đồ cột 2");
    expect(m.get("c")).toBe("Biểu đồ cột 3");
    expect(m.get("d")).toBe("Văn bản: Ghi chú quan trọng");
    expect(m.get("e")).toBe("KPI 1");
  });
  it("nhiều trang thì thêm tên trang", () => {
    const m = widgetLabels({
      pages: [{ id: "p1", name: "Tổng quan" }, { id: "p2", name: "Chi tiết" }],
      widgets: [w("a", { kind: "kpi", title: "Lãi" }, "p2")],
    });
    expect(m.get("a")).toBe("KPI: Lãi · Chi tiết");
  });
});
