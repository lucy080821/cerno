import { describe, expect, it } from "vitest";
import { createWidget, smartFields } from "./defaults";

const cols = [
  { name: "Video title", type: "string" as const },
  { name: "Publish time", type: "date" as const },
  { name: "Views", type: "number" as const },
  { name: "Likes", type: "number" as const },
];

describe("smartFields / createWidget với nguồn thật", () => {
  it("cột: chiều là cột chữ, số đo là cột số đầu tiên", () => {
    const f = smartFields(cols, "bar");
    expect(f.dim.name).toBe("Video title");
    expect(f.metric).toEqual({ column: "Views", aggregation: "sum" });
    expect(f.metric2).toEqual({ column: "Likes", aggregation: "sum" });
  });
  it("đường/vùng ưu tiên cột ngày", () => {
    expect(smartFields(cols, "line").dim.name).toBe("Publish time");
  });
  it("không có cột số thì đếm dòng", () => {
    const f = smartFields([{ name: "Tên", type: "string" }], "pie");
    expect(f.metric).toEqual({ column: "Tên", aggregation: "count" });
  });
  it("widget mới trỏ đúng nguồn và cột có thật", () => {
    const w = createWidget("bar", { x: 0, y: 0 }, "src-1", cols);
    if (w.config.kind !== "chart") throw new Error("phải là chart");
    expect(w.config.sourceId).toBe("src-1");
    expect(w.config.dimensions[0].column).toBe("Video title");
    expect(w.config.metrics[0].column).toBe("Views");
  });
  it("nguồn mẫu giữ nguyên mặc định cũ", () => {
    const w = createWidget("bar", { x: 0, y: 0 });
    if (w.config.kind !== "chart") throw new Error("phải là chart");
    expect(w.config.metrics[0].column).toBe("Doanh thu");
  });
});
