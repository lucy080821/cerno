import { beforeEach, describe, expect, it } from "vitest";
import { addChartToDashboard, runShowChart, ShowChartSchema } from "./ai-chart";
import { resetCalcSync, syncCalc } from "./calc";
import { createDemoDashboard } from "./defaults";
import { useEditor } from "./store";

const pie = { chartType: "pie", dimensions: ["Khu vực"], metrics: [{ column: "Doanh thu", aggregation: "sum" }] };
const byMonth = {
  chartType: "pie",
  dimensions: ["Tháng đăng"],
  metrics: [{ column: "Doanh thu", aggregation: "sum" }],
  calculated_fields: [{ name: "Tháng đăng", expression: "YEAR_MONTH([Ngày])" }],
};

let unsub: (() => void) | null = null;
beforeEach(() => {
  unsub?.();
  const doc = createDemoDashboard();
  useEditor.getState().loadDoc(doc);
  resetCalcSync();
  syncCalc(doc);
  // Giống EditorApp: đổi trường tính toán trong doc thì biên dịch lại.
  unsub = useEditor.subscribe((cur, prev) => {
    if (cur.doc.calculatedFields !== prev.doc.calculatedFields) syncCalc(cur.doc);
  });
});

describe("show_chart: vẽ biểu đồ trong khung chat", () => {
  it("vẽ biểu đồ tròn từ cột có sẵn, trả số liệu cho model", async () => {
    const r = await runShowChart(useEditor.getState().doc, pie, {});
    expect(r.ok).toBe(true);
    expect(r.chart!.config).toMatchObject({ kind: "chart", chartType: "pie" });
    expect(r.chart!.table.rows.length).toBeGreaterThan(1);
    expect(r.message).toContain("Đã hiển thị biểu đồ");
    expect(r.message).toContain("Thêm vào dashboard");
    expect(r.chart!.newFields).toEqual([]);
    expect(r.chart!.config.title).toBe("Tổng Doanh thu theo Khu vực");
  });

  it("nhóm theo tháng bằng trường tính toán tạm, và nhớ trường này để tạo khi thêm vào dashboard", async () => {
    const r = await runShowChart(useEditor.getState().doc, byMonth, {});
    expect(r.ok, r.message).toBe(true);
    expect(r.chart!.table.rows.every((x) => /^\d{4}-\d{2}$/.test(String(x.keys[0])))).toBe(true);
    expect(r.chart!.newFields).toEqual([{ name: "Tháng đăng", expression: "YEAR_MONTH([Ngày])" }]);
    // Chỉ vẽ thử: dashboard không bị đụng tới.
    expect(useEditor.getState().doc.calculatedFields).toHaveLength(0);
  });

  it("áp bộ lọc dashboard đang bật", async () => {
    const doc = useEditor.getState().doc;
    const all = await runShowChart(doc, pie, {});
    const region = String(all.chart!.table.rows[0].keys[0]);
    const f = createDemoDashboard();
    const filter = { id: "f1", sourceId: doc.sources[0].id, column: "Khu vực", control: "multiselect" as const };
    const r = await runShowChart({ ...f, filters: [filter] }, pie, { f1: { values: [region] } });
    expect(r.chart!.filtered).toBe(true);
    expect(r.chart!.table.rows.map((x) => x.keys[0])).toEqual([region]);
  });

  it("báo lỗi rõ để model tự sửa", async () => {
    const doc = useEditor.getState().doc;
    const noCol = await runShowChart(doc, { ...pie, dimensions: ["Không có"] }, {});
    expect(noCol.ok).toBe(false);
    expect(noCol.message).toContain("Các cột có sẵn");

    const badFormula = await runShowChart(doc, { ...byMonth, calculated_fields: [{ name: "Tháng đăng", expression: "YEAR_MONTH(" }] }, {});
    expect(badFormula.ok).toBe(false);
    expect(badFormula.message).toContain("lỗi");

    const sumText = await runShowChart(doc, { ...pie, metrics: [{ column: "Khu vực", aggregation: "sum" }] }, {});
    expect(sumText.ok).toBe(false);

    const needDims = await runShowChart(doc, { chartType: "pie", metrics: pie.metrics }, {});
    expect(needDims.ok).toBe(false);
    expect(needDims.message).toContain("dimension");
  });

  it("từ chối tham số sai: loại bảng, quá nhiều trường tạm, công thức quá dài", () => {
    expect(ShowChartSchema.safeParse({ ...pie, chartType: "table" }).success).toBe(false);
    expect(ShowChartSchema.safeParse({ ...pie, chartType: "sql" }).success).toBe(false);
    const four = Array.from({ length: 4 }, (_, i) => ({ name: `f${i}`, expression: "1" }));
    expect(ShowChartSchema.safeParse({ ...pie, calculated_fields: four }).success).toBe(false);
    expect(ShowChartSchema.safeParse({ ...pie, calculated_fields: [{ name: "a", expression: "1".repeat(1001) }] }).success).toBe(false);
    expect(ShowChartSchema.safeParse({ ...pie, metrics: [] }).success).toBe(false);
  });

  it("trùng tên với trường đã có nhưng khác công thức thì từ chối; cùng công thức thì dùng lại", async () => {
    const ed = useEditor.getState();
    const doc = ed.doc;
    ed.mutate((d) => ({
      ...d,
      calculatedFields: [{ id: "c1", sourceId: doc.sources[0].id, name: "Tháng đăng", expression: "YEAR_MONTH([Ngày])" }],
    }));
    const same = await runShowChart(useEditor.getState().doc, byMonth, {});
    expect(same.ok, same.message).toBe(true);
    expect(same.chart!.newFields).toEqual([]); // đã có sẵn, không tạo thêm
    const diff = await runShowChart(useEditor.getState().doc, { ...byMonth, calculated_fields: [{ name: "Tháng đăng", expression: "MONTH([Ngày])" }] }, {});
    expect(diff.ok).toBe(false);
    expect(diff.message).toContain("công thức khác");
  });
});

describe("Thêm vào dashboard", () => {
  it("thêm widget thật, tạo kèm trường tính toán, và hoàn tác được bằng MỘT lần Ctrl+Z", async () => {
    const before = useEditor.getState().doc;
    const r = await runShowChart(before, byMonth, {});
    expect(addChartToDashboard(r.chart!)).toBeNull();

    const after = useEditor.getState().doc;
    expect(after.calculatedFields.map((f) => f.name)).toEqual(["Tháng đăng"]);
    const w = after.widgets.at(-1)!;
    expect(w.config.kind === "chart" && w.config.chartType).toBe("pie");
    expect(w.config.kind === "chart" && w.config.dimensions[0].column).toBe("Tháng đăng");
    expect(useEditor.getState().selection).toEqual([w.id]);

    useEditor.getState().undo();
    const undone = useEditor.getState().doc;
    expect(undone.widgets).toHaveLength(before.widgets.length);
    expect(undone.calculatedFields).toHaveLength(0);
  });

  it("biểu đồ không cần trường tạm thì chỉ thêm widget", async () => {
    const before = useEditor.getState().doc;
    const r = await runShowChart(before, pie, {});
    expect(addChartToDashboard(r.chart!)).toBeNull();
    const after = useEditor.getState().doc;
    expect(after.widgets).toHaveLength(before.widgets.length + 1);
    expect(after.calculatedFields).toHaveLength(0);
  });

  it("trường tạm trùng tên nhưng khác công thức thì báo lỗi và không đổi gì", async () => {
    const r = await runShowChart(useEditor.getState().doc, byMonth, {});
    const ed = useEditor.getState();
    ed.mutate((d) => ({
      ...d,
      calculatedFields: [{ id: "x", sourceId: d.sources[0].id, name: "Tháng đăng", expression: "MONTH([Ngày])" }],
    }));
    const snapshot = useEditor.getState().doc;
    expect(addChartToDashboard(r.chart!)).toContain("công thức khác");
    expect(useEditor.getState().doc).toBe(snapshot);
  });

  it("nguồn không còn trong dashboard thì báo lỗi", async () => {
    const r = await runShowChart(useEditor.getState().doc, pie, {});
    useEditor.getState().mutate((d) => ({ ...d, sources: [] }));
    expect(addChartToDashboard(r.chart!)).toContain("không còn");
  });
});
