import { describe, expect, it } from "vitest";
import { Dashboard } from "@dashboard/schema";
import { runQuery, type Row } from "@dashboard/chart-engine";
import { buildReportFacts, fitFactsSize, viShort, MAX_FACTS_BYTES, type Executor, type ReportFacts } from "./facts";
import { reportPeriods } from "./period";

// Kỳ báo cáo: tháng 10/2025 (so với tháng 9/2025).
const periods = reportPeriods("monthly", new Date("2025-11-03T01:00:00Z"));

const rows: Row[] = [
  // Tháng 9
  { Ngày: "2025-09-05", Tỉnh: "Hà Nội", "Doanh thu": 100, Đơn: 2 },
  { Ngày: "2025-09-20", Tỉnh: "Đà Nẵng", "Doanh thu": 300, Đơn: 3 },
  { Ngày: "2025-09-25", Tỉnh: "Cần Thơ", "Doanh thu": 50, Đơn: 1 },
  // Tháng 10
  { Ngày: "2025-10-02", Tỉnh: "Hà Nội", "Doanh thu": 400, Đơn: 4 },
  { Ngày: "2025-10-15", Tỉnh: "Đà Nẵng", "Doanh thu": 100, Đơn: 1 },
  { Ngày: "15/10/2025", Tỉnh: "Huế", "Doanh thu": 200, Đơn: 2 },
  // Ngoài hai kỳ: không được tính
  { Ngày: "2025-11-01", Tỉnh: "Hà Nội", "Doanh thu": 9999, Đơn: 99 },
  { Ngày: "2025-08-31", Tỉnh: "Hà Nội", "Doanh thu": 8888, Đơn: 88 },
];

const exec: Executor = async (_id, spec) => runQuery(rows, spec);

const box = { x: 0, y: 0, w: 200, h: 100 };
const sum = (column: string) => ({ column, aggregation: "sum" as const });

function makeDoc(widgets: unknown[], extra: Record<string, unknown> = {}) {
  return Dashboard.parse({
    schemaVersion: 1, id: "d", name: "D", canvas: { width: 1000, height: 600, background: "#fff" },
    sources: [{
      id: "s", type: "google_sheets", spreadsheetId: "x", sheetName: "T",
      columns: [{ name: "Ngày", type: "date" }, { name: "Tỉnh", type: "string" }, { name: "Doanh thu", type: "number" }, { name: "Đơn", type: "number" }],
    }],
    widgets, ...extra,
  });
}
const kpi = (id: string, y: number, metric: unknown, extra: Record<string, unknown> = {}) =>
  ({ id, ...box, y, config: { kind: "kpi", sourceId: "s", metric, ...extra } });
const chart = (id: string, y: number, chartType: string, dimensions: unknown[], metrics: unknown[], title?: string) =>
  ({ id, ...box, y, config: { kind: "chart", chartType, sourceId: "s", dimensions, metrics, title } });

describe("viShort", () => {
  it("rút gọn theo nghìn/triệu/tỷ kiểu Việt Nam", () => {
    expect(viShort(980)).toBe("980");
    expect(viShort(12_345)).toBe("12,3 nghìn");
    expect(viShort(125_430_000)).toBe("125,4 triệu");
    expect(viShort(2_340_000_000)).toBe("2,3 tỷ");
    expect(viShort(-5_000_000)).toBe("-5 triệu");
  });
});

describe("buildReportFacts: KPI", () => {
  it("giá trị kỳ này, kỳ trước, % tăng trưởng; không lẫn dòng ngoài hai kỳ", async () => {
    const doc = makeDoc([kpi("k1", 0, sum("Doanh thu"), { title: "Doanh thu" })]);
    const f = await buildReportFacts({ doc, periods, exec, updatedAt: "2025-11-03T00:00:00Z" });
    const k = f.kpis[0];
    expect(k.title).toBe("Doanh thu");
    expect(k.value?.value).toBe(700);
    expect(k.prev?.value).toBe(450);
    expect(k.diff?.value).toBe(250);
    expect(k.growthPct).toBe(55.6); // (700-450)/450
    expect(k.growthText).toBe("+55,6%");
    expect(k.dir).toBe("up");
    expect(k.tone).toBe("good");
    expect(f.period.label).toBe("Tháng 10/2025");
    expect(f.prevPeriod.label).toBe("Tháng 09/2025");
    expect(f.updatedAt).toBe("2025-11-03T00:00:00Z");
  });

  it("goodWhen=down: tăng là xấu (đỏ) theo cấu hình so kỳ của KPI", async () => {
    const compare = { to: "prev_period", dateColumn: "Ngày", grain: "month", show: "percent", goodWhen: "down", toDate: false };
    const f = await buildReportFacts({ doc: makeDoc([kpi("k", 0, sum("Doanh thu"), { compare })]), periods, exec });
    expect(f.kpis[0].dir).toBe("up");
    expect(f.kpis[0].tone).toBe("bad");
  });

  it("show=diff / pp theo cấu hình của KPI", async () => {
    const mk = (show: string) => makeDoc([kpi("k", 0, sum("Đơn"), { compare: { to: "prev_period", dateColumn: "Ngày", grain: "month", show, goodWhen: "up", toDate: false } })]);
    expect((await buildReportFacts({ doc: mk("diff"), periods, exec })).kpis[0].growthText).toBe("+1"); // 7 - 6
    expect((await buildReportFacts({ doc: mk("pp"), periods, exec })).kpis[0].growthText).toBe("+1 pp");
  });

  it("kỳ trước = 0: không có % nhưng vẫn có giá trị", async () => {
    const only10 = rows.filter((r) => String(r.Ngày).includes("2025-10") || String(r.Ngày).includes("/10/"));
    const f = await buildReportFacts({ doc: makeDoc([kpi("k", 0, sum("Doanh thu"))]), periods, exec: async (_i, s) => runQuery(only10, s) });
    expect(f.kpis[0].prev).toBeNull(); // không có dòng nào ở kỳ trước
    expect(f.kpis[0].growthPct).toBeNull();
    expect(f.kpis[0].growthText).toBe("");
    expect(f.kpis[0].value?.value).toBe(700);
  });

  it("kỳ trước có dòng nhưng tổng bằng 0: không chia cho 0", async () => {
    const zeroPrev: Row[] = [{ Ngày: "2025-09-01", Tỉnh: "A", "Doanh thu": 0, Đơn: 0 }, { Ngày: "2025-10-01", Tỉnh: "A", "Doanh thu": 10, Đơn: 1 }];
    const f = await buildReportFacts({ doc: makeDoc([kpi("k", 0, sum("Doanh thu"))]), periods, exec: async (_i, s) => runQuery(zeroPrev, s) });
    expect(f.kpis[0].prev?.value).toBe(0);
    expect(f.kpis[0].growthPct).toBeNull();
    expect(f.kpis[0].growthText).toBe("");
  });

  it("kỳ này không có dòng: value = null và có ghi chú", async () => {
    const f = await buildReportFacts({ doc: makeDoc([kpi("k", 0, sum("Doanh thu"))]), periods, exec: async (_i, s) => runQuery([], s) });
    expect(f.kpis[0].value).toBeNull();
    expect(f.kpis[0].growthText).toBe("");
    expect(f.notes).toContain("Không có dữ liệu nào trong kỳ báo cáo.");
  });

  it("nguồn không có cột ngày: tính toàn bộ dữ liệu và ghi chú", async () => {
    const doc = makeDoc([kpi("k", 0, sum("Doanh thu"), { title: "Tổng" })]);
    doc.sources = [{ id: "s", type: "google_sheets", spreadsheetId: "x", sheetName: "T", columns: [{ name: "Doanh thu", type: "number" }] }];
    const f = await buildReportFacts({ doc, periods, exec });
    expect(f.kpis[0].value?.value).toBe(100 + 300 + 50 + 400 + 100 + 200 + 9999 + 8888);
    expect(f.kpis[0].prev).toBeNull();
    expect(f.notes.join("|")).toMatch(/"Tổng" không có cột ngày/);
  });

  it("dùng trường tính toán và bỏ qua widget ẩn, văn bản; sắp xếp theo thứ tự đọc (trên→dưới)", async () => {
    const doc = makeDoc(
      [
        kpi("k2", 200, sum("Gấp đôi"), { title: "B" }),
        { id: "t", ...box, config: { kind: "text", text: "x", fontSize: 16, bold: false, align: "left" } },
        { ...kpi("kh", 0, sum("Doanh thu")), hidden: true },
        kpi("k1", 100, sum("Doanh thu"), { title: "A" }),
      ],
      { calculatedFields: [{ id: "c", sourceId: "s", name: "Gấp đôi", expression: "[Doanh thu] * 2" }] },
    );
    const f = await buildReportFacts({ doc, periods, exec });
    expect(f.kpis.map((k) => [k.title, k.value?.value])).toEqual([["A", 700], ["B", 1400]]);
  });

  it("số đo là ngày (MAX cột ngày): không tính %, hiển thị dd/mm/yyyy", async () => {
    const f = await buildReportFacts({ doc: makeDoc([kpi("k", 0, { column: "Ngày", aggregation: "max" })]), periods, exec });
    expect(f.kpis[0].kind).toBe("date");
    expect(f.kpis[0].growthPct).toBeNull();
    expect(f.kpis[0].value?.text).toBe("15/10/2025");
  });

  it("số liệu có định dạng đầy đủ và gọn", async () => {
    const big: Row[] = [{ Ngày: "2025-10-10", Tỉnh: "A", "Doanh thu": 125_430_000, Đơn: 1 }];
    const f = await buildReportFacts({ doc: makeDoc([kpi("k", 0, sum("Doanh thu"))]), periods, exec: async (_i, s) => runQuery(big, s) });
    expect(f.kpis[0].value).toEqual({ value: 125_430_000, text: "125.430.000", short: "125,4 triệu" });
  });
});

describe("buildReportFacts: movers", () => {
  const doc = () => makeDoc([chart("c1", 0, "bar", [{ column: "Tỉnh" }], [sum("Doanh thu")], "Doanh thu theo tỉnh")]);

  it("top tăng và top giảm theo nhóm giữa hai kỳ, kèm giá trị", async () => {
    const f = await buildReportFacts({ doc: doc(), periods, exec });
    const m = f.movers[0];
    expect(m.chart).toBe("Doanh thu theo tỉnh");
    expect(m.dimension).toBe("Tỉnh");
    // Hà Nội 100→400 (+300), Huế 0→200 (+200); Đà Nẵng 300→100 (−200), Cần Thơ 50→0 (−50)
    expect(m.up.map((x) => [x.name, x.delta.value, x.value.value])).toEqual([["Hà Nội", 300, 400], ["Huế", 200, 200]]);
    expect(m.down.map((x) => [x.name, x.delta.value, x.value.value])).toEqual([["Đà Nẵng", -200, 100], ["Cần Thơ", -50, 0]]);
  });

  it("tối đa 3 mỗi phía", async () => {
    const many: Row[] = [];
    for (let i = 0; i < 6; i++) many.push({ Ngày: "2025-10-05", Tỉnh: `T${i}`, "Doanh thu": 10 * (i + 1), Đơn: 1 });
    const f = await buildReportFacts({ doc: doc(), periods, exec: async (_i, s) => runQuery(many, s) });
    expect(f.movers[0].up.map((x) => x.name)).toEqual(["T5", "T4", "T3"]);
    expect(f.movers[0].down).toEqual([]);
  });

  it("bỏ qua chart có chiều ngày/gom ngày, bảng, và chart không có thay đổi nào", async () => {
    const d = makeDoc([
      chart("a", 0, "line", [{ column: "Ngày", grain: "month" }], [sum("Doanh thu")]),
      chart("b", 100, "bar", [{ column: "Ngày" }], [sum("Doanh thu")]),
      chart("c", 200, "table", [{ column: "Tỉnh" }], [sum("Doanh thu")]),
    ]);
    expect((await buildReportFacts({ doc: d, periods, exec })).movers).toEqual([]);
    const same: Row[] = [{ Ngày: "2025-09-05", Tỉnh: "A", "Doanh thu": 5, Đơn: 1 }, { Ngày: "2025-10-05", Tỉnh: "A", "Doanh thu": 5, Đơn: 1 }];
    expect((await buildReportFacts({ doc: doc(), periods, exec: async (_i, s) => runQuery(same, s) })).movers).toEqual([]);
  });

  it("chỉ lấy tối đa 4 chart", async () => {
    const d = makeDoc(Array.from({ length: 6 }, (_, i) => chart(`c${i}`, i * 10, "bar", [{ column: "Tỉnh" }], [sum("Doanh thu")], `C${i}`)));
    expect((await buildReportFacts({ doc: d, periods, exec })).movers).toHaveLength(4);
  });
});

describe("kích thước gói", () => {
  it("dashboard lớn bị rút gọn xuống ≤ 6 KB, có ghi chú, vẫn còn KPI đầu", async () => {
    const widgets: unknown[] = [];
    for (let i = 0; i < 12; i++) widgets.push(kpi(`k${i}`, i, sum("Doanh thu"), { title: `Chỉ số số ${i} có tên khá là dài dòng để tăng kích thước` }));
    for (let i = 0; i < 4; i++) widgets.push(chart(`c${i}`, 100 + i, "bar", [{ column: "Tỉnh" }], [sum("Doanh thu")], `Biểu đồ ${i} có tiêu đề rất dài để làm to gói số liệu lên`));
    const many: Row[] = [];
    for (let i = 0; i < 40; i++) {
      many.push({ Ngày: "2025-10-05", Tỉnh: `Tỉnh có tên dài số ${i}`, "Doanh thu": 1000 * (i + 1), Đơn: 1 });
      many.push({ Ngày: "2025-09-05", Tỉnh: `Tỉnh có tên dài số ${i}`, "Doanh thu": 1000 * (40 - i), Đơn: 1 });
    }
    const raw = await buildReportFacts({ doc: makeDoc(widgets), periods, exec: async (_i, s) => runQuery(many, s) });
    const bytes = new TextEncoder().encode(JSON.stringify(raw)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_FACTS_BYTES);
    expect(raw.kpis.length).toBeGreaterThanOrEqual(1);
  });

  it("fitFactsSize: gói nhỏ giữ nguyên; gói quá lớn bị cắt dần và ghi chú", () => {
    const mini: ReportFacts = {
      period: { from: "a", to: "b", label: "L" }, prevPeriod: { from: "a", to: "b", label: "P" }, updatedAt: null,
      kpis: [], movers: [], notes: [],
    };
    expect(fitFactsSize(mini)).toBe(mini);
    const big: ReportFacts = { ...mini, kpis: Array.from({ length: 12 }, (_, i) => ({
      title: `K${i}`.padEnd(300, "x"), value: null, prev: null, diff: null, widgetId: "w", growthPct: null, growthText: "", dir: null, tone: "neutral" as const, kind: "number" as const,
    })) };
    const out = fitFactsSize(big, 1500);
    expect(new TextEncoder().encode(JSON.stringify(out)).length).toBeLessThanOrEqual(1500);
    expect(out.notes.join()).toMatch(/rút gọn/);
    expect(out.kpis.length).toBeGreaterThanOrEqual(1);
  });

  it("deterministic: chạy hai lần ra đúng cùng kết quả", async () => {
    const d = makeDoc([kpi("k", 0, sum("Doanh thu")), chart("c", 10, "bar", [{ column: "Tỉnh" }], [sum("Doanh thu")])]);
    const a = await buildReportFacts({ doc: d, periods, exec });
    const b = await buildReportFacts({ doc: d, periods, exec });
    expect(a).toEqual(b);
  });
});
