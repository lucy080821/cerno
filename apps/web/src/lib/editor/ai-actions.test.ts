import { describe, expect, it } from "vitest";
import { createDemoDashboard } from "./defaults";
import { applyAiAction, applyAiActions } from "./ai-actions";

const doc = () => createDemoDashboard();
const chartIds = (d: ReturnType<typeof doc>) => d.widgets.filter((w) => w.config.kind === "chart").map((w) => w.id);

describe("applyAiAction", () => {
  it("thêm biểu đồ hợp lệ, tự đặt tiêu đề và đặt dưới cùng", () => {
    const d = doc();
    const r = applyAiAction(d, "add_widget", {
      kind: "bar", dimensions: ["Khu vực"], metrics: [{ column: "Doanh thu", aggregation: "sum" }],
    });
    expect(r.ok).toBe(true);
    const w = r.doc.widgets.at(-1)!;
    expect(w.config.kind === "chart" && w.config.title).toBe("Tổng Doanh thu theo Khu vực");
    expect(w.y).toBeGreaterThanOrEqual(Math.max(...d.widgets.map((x) => x.y + x.h)));
    expect(r.doc.canvas.height).toBeGreaterThanOrEqual(w.y + w.h);
    expect(r.message).toContain(w.id);
  });

  it("từ chối cột không tồn tại và liệt kê cột có sẵn", () => {
    const r = applyAiAction(doc(), "add_widget", { kind: "bar", dimensions: ["Không có"], metrics: [{ column: "Doanh thu" }] });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Các cột có sẵn");
  });

  it("từ chối sum trên cột chữ, cho phép count", () => {
    const bad = applyAiAction(doc(), "add_widget", { kind: "kpi", metrics: [{ column: "Kênh", aggregation: "sum" }] });
    expect(bad.ok).toBe(false);
    const good = applyAiAction(doc(), "add_widget", { kind: "kpi", metrics: [{ column: "Kênh", aggregation: "count_distinct" }] });
    expect(good.ok).toBe(true);
  });

  it("từ chối tham số sai kiểu/ngoài khoảng", () => {
    expect(applyAiAction(doc(), "add_widget", { kind: "bar", x: -5 }).ok).toBe(false);
    expect(applyAiAction(doc(), "update_widget", { id: chartIds(doc())[0], background: "đỏ" }).ok).toBe(false);
    expect(applyAiAction(doc(), "khong_co", {}).ok).toBe(false);
  });

  it("sửa định dạng chart: tắt trục Y, bật nhãn, gộp kiểu chữ tiêu đề", () => {
    const d = doc();
    const id = chartIds(d)[0];
    const r = applyAiAction(d, "update_widget", {
      id, format: { showYAxis: false, showDataLabels: true, title: { italic: true } },
    });
    expect(r.ok).toBe(true);
    const cfg = r.doc.widgets.find((w) => w.id === id)!.config;
    expect(cfg.kind === "chart" && cfg.format).toMatchObject({ showYAxis: false, showDataLabels: true, title: { italic: true } });
    const r2 = applyAiAction(r.doc, "update_widget", { id, format: { title: { bold: false } } });
    const c2 = r2.doc.widgets.find((w) => w.id === id)!.config;
    expect(c2.kind === "chart" && c2.format?.title).toEqual({ italic: true, bold: false });
  });

  it("đổi sang biểu đồ tròn thì chỉ giữ 1 chiều và 1 số đo", () => {
    const d = doc();
    const id = d.widgets.find((w) => w.config.kind === "chart" && w.config.dimensions.length === 2)!.id;
    const r = applyAiAction(d, "update_widget", { id, chartType: "pie" });
    const cfg = r.doc.widgets.find((w) => w.id === id)!.config;
    expect(cfg.kind === "chart" && cfg.dimensions.length).toBe(1);
  });

  it("không đổi vị trí/xoá widget đang khoá", () => {
    const d = doc();
    const id = d.widgets[0].id;
    const locked = { ...d, widgets: d.widgets.map((w) => (w.id === id ? { ...w, locked: true } : w)) };
    expect(applyAiAction(locked, "update_widget", { id, x: 10 }).ok).toBe(false);
    expect(applyAiAction(locked, "delete_widget", { id }).ok).toBe(false);
    expect(applyAiAction(locked, "update_widget", { id, radius: 4 }).ok).toBe(true);
  });

  it("xoá widget", () => {
    const d = doc();
    const r = applyAiAction(d, "delete_widget", { id: d.widgets[0].id });
    expect(r.doc.widgets.length).toBe(d.widgets.length - 1);
  });

  it("set_filter_value tự tạo bộ lọc nếu chưa có", () => {
    const r = applyAiAction(doc(), "set_filter_value", { column: "Khu vực", values: ["Miền Bắc"] });
    expect(r.ok).toBe(true);
    expect(r.doc.filters).toHaveLength(1);
    expect(r.filterOps[0].value).toEqual({ values: ["Miền Bắc"] });
  });

  it("bộ lọc ngày: cần from/to hợp lệ", () => {
    const d = doc();
    expect(applyAiAction(d, "set_filter_value", { column: "Ngày", from: "2025-03-01", to: "2025-02-01" }).ok).toBe(false);
    expect(applyAiAction(d, "set_filter_value", { column: "Ngày", from: "01/03/2025" }).ok).toBe(false);
    const r = applyAiAction(d, "set_filter_value", { column: "Ngày", from: "2025-03-01", to: "2025-04-30" });
    expect(r.ok).toBe(true);
    expect(r.doc.filters[0].control).toBe("date_range");
    expect(r.filterOps[0].value).toEqual({ from: "2025-03-01", to: "2025-04-30" });
  });

  it("clear bỏ giá trị lọc", () => {
    const r = applyAiAction(doc(), "set_filter_value", { column: "Khu vực", clear: true });
    expect(r.filterOps[0].value).toBeNull();
  });

  it("update_dashboard đổi tên, kích thước, nền", () => {
    const r = applyAiAction(doc(), "update_dashboard", { name: "Mới", width: 1920, height: 1080, background: "#112233", themeMode: "dark" });
    expect(r.doc).toMatchObject({ name: "Mới", canvas: { width: 1920, height: 1080, background: "#112233" }, theme: { mode: "dark" } });
  });

  it("giới hạn số lệnh mỗi lượt", () => {
    const calls = Array.from({ length: 20 }, () => ({ name: "update_dashboard", args: { name: "x" } }));
    const r = applyAiActions(doc(), calls);
    expect(r.results.filter((x) => x.ok)).toHaveLength(15);
    expect(r.results).toHaveLength(20);
  });
});
