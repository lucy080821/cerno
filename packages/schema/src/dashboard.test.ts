import { describe, expect, it } from "vitest";
import { KpiConfig, ChartFormat, TextConfig } from "./dashboard";

const kpi = { kind: "kpi", sourceId: "s", metric: { column: "Views", aggregation: "sum" } };

describe("định dạng chữ (tương thích ngược)", () => {
  it("KPI cũ không có kiểu chữ vẫn hợp lệ", () => {
    const r = KpiConfig.safeParse(kpi);
    expect(r.success).toBe(true);
  });
  it("KPI nhận kiểu chữ cho tiêu đề và con số; cỡ số tới 300px", () => {
    expect(KpiConfig.safeParse({ ...kpi, titleStyle: { color: "#ff0000", bold: true }, valueStyle: { fontSize: 200, color: "#00aa00" } }).success).toBe(true);
    expect(KpiConfig.safeParse({ ...kpi, valueStyle: { fontSize: 400 } }).success).toBe(false);
  });
  it("bảng nhận kiểu chữ của tiêu đề cột và ô dữ liệu", () => {
    const r = ChartFormat.safeParse({ tableHeader: { color: "#111111", italic: true }, tableCell: { fontSize: 14 } });
    expect(r.success).toBe(true);
  });
  it("văn bản nhận font, nghiêng, gạch chân", () => {
    const r = TextConfig.safeParse({ kind: "text", text: "a", fontFamily: "Arial, sans-serif", italic: true, underline: true });
    expect(r.success).toBe(true);
  });
  it("căn lề: KPI, tiêu đề, bảng; từ chối giá trị lạ", () => {
    expect(KpiConfig.safeParse({ ...kpi, align: "center" }).success).toBe(true);
    expect(KpiConfig.safeParse({ ...kpi, align: "justify" }).success).toBe(false);
    expect(ChartFormat.safeParse({ titleAlign: "right", tableAlign: "center" }).success).toBe(true);
    expect(ChartFormat.safeParse({ tableAlign: "top" }).success).toBe(false);
  });
});
