import { describe, expect, it } from "vitest";
import { Dashboard } from "@dashboard/schema";
import { runQuery, type QuerySpec, type Row } from "@dashboard/chart-engine";
import type { Executor, KpiFact } from "./facts";
import { buildReportFacts } from "./facts";
import { reportPeriods } from "./period";
import {
  IMAGE_WIDTH, MAX_IMAGES, escapeXml, fitImageBudget, kpiCardSvg, pickImageWidgets, renderReportImages, svgToPng, withTitle,
} from "./render-chart";

const PNG_SIG = "89504e470d0a1a0a";
const isPng = (b: Buffer) => b.subarray(0, 8).toString("hex") === PNG_SIG;

const num = (value: number, text: string, short: string) => ({ value, text, short });
const kpiFact = (over: Partial<KpiFact> = {}): KpiFact => ({
  widgetId: "k1", title: "Doanh thu", value: num(125_430_000, "125.430.000", "125,4 triệu"), prev: num(100_000_000, "100.000.000", "100 triệu"),
  diff: num(25_430_000, "25.430.000", "25,4 triệu"), growthPct: 25.4, growthText: "+25,4%", dir: "up", tone: "good", kind: "number", ...over,
});

describe("escapeXml", () => {
  it("thoát mọi ký tự đặc biệt của XML", () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
  });
});

describe("thẻ KPI", () => {
  it("vẽ được PNG hợp lệ rộng 600px, có tam giác thay cho ký tự ▲▼", () => {
    const svg = kpiCardSvg(kpiFact());
    expect(svg).toContain("<polygon");
    expect(svg).not.toMatch(/[▲▼]/);
    const r = svgToPng(svg);
    expect(isPng(r.png)).toBe(true);
    expect(r.width).toBe(IMAGE_WIDTH);
    expect(r.png.length).toBeGreaterThan(3000); // có chữ được vẽ, không phải ảnh trống
  });

  it("hướng và màu: giảm = tam giác ngược + đỏ; ngang = thanh; không có hướng = không có biểu tượng", () => {
    const down = kpiCardSvg(kpiFact({ dir: "down", tone: "bad", growthText: "−17,7%" }));
    expect(down).toContain("#dc2626");
    expect(down).toContain('points="24,105 36,105 30,117"');
    expect(kpiCardSvg(kpiFact({ dir: "flat", tone: "neutral", growthText: "0%" }))).toContain("<rect x=\"24\" y=\"109\"");
    expect(kpiCardSvg(kpiFact({ dir: null, tone: "neutral", growthText: "" }))).not.toContain("<polygon");
  });

  it("số quá dài dùng dạng gọn; không có số liệu thì hiện dấu —", () => {
    expect(kpiCardSvg(kpiFact({ value: num(1, "1.234.567.890.123", "1,2 nghìn tỷ") }))).toContain("1,2 nghìn tỷ");
    const empty = kpiCardSvg(kpiFact({ value: null, prev: null, growthText: "", dir: null, tone: "neutral" }));
    expect(empty).toContain("—");
    expect(empty).toContain("Không có dữ liệu trong kỳ");
  });

  it("chữ do người dùng đặt bị thoát: không chèn được thẻ/thuộc tính SVG", () => {
    const evil = `</text><script>alert(1)</script><image href="http://x/y"/>"'&`;
    const svg = kpiCardSvg(kpiFact({ title: evil, growthText: evil }));
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("<image");
    expect(svg).toContain("&lt;script&gt;");
    expect(() => svgToPng(svg)).not.toThrow(); // vẫn là SVG hợp lệ
  });

  it("tiêu đề rất dài bị cắt, ký tự điều khiển bị bỏ", () => {
    const svg = kpiCardSvg(kpiFact({ title: "A".repeat(200) + "\u0000\u0007" }));
    expect(svg).toContain("…");
    expect(svg).not.toMatch(/[\u0000-\u0008]/);
    expect(() => svgToPng(svg)).not.toThrow();
  });
});

describe("withTitle", () => {
  const inner = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" fill="#eee"/></svg>`;
  it("thêm dải tiêu đề 38px phía trên và vẫn là SVG hợp lệ", () => {
    const svg = withTitle(inner, "Doanh thu theo tháng", 600, 200);
    expect(svg).toContain("Doanh thu theo tháng");
    expect(svg).toContain(`height="238"`);
    const r = svgToPng(svg);
    expect(r.width).toBe(600);
    expect(r.height).toBe(238);
  });
  it("không có tiêu đề thì giữ nguyên biểu đồ", () => {
    expect(withTitle(inner, "   ", 600, 200)).toBe(inner);
  });
  it("tiêu đề bị thoát và cắt", () => {
    const svg = withTitle(inner, `<script>x</script>${"A".repeat(100)}`, 600, 200);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("…");
    expect(() => svgToPng(svg)).not.toThrow();
  });
});

describe("fitImageBudget", () => {
  const img = (n: number) => ({ png: Buffer.alloc(n) });
  it("giữ các ảnh đầu tới khi chạm trần, bỏ phần còn lại", () => {
    const r = fitImageBudget([img(400), img(400), img(400), img(100)], 1000);
    expect(r.kept).toHaveLength(2);
    expect(r.dropped).toBe(2);
  });
  it("đủ chỗ thì giữ hết", () => {
    expect(fitImageBudget([img(10), img(10)], 1000)).toMatchObject({ dropped: 0 });
  });
});

// ---------------------------------------------------------------------------------------------

const periods = reportPeriods("monthly", new Date("2025-11-03T01:00:00Z")); // tháng 10/2025 so với tháng 9
const rows: Row[] = [
  { Ngày: "2025-08-10", Tỉnh: "Hà Nội", "Doanh thu": 50 },
  { Ngày: "2025-09-05", Tỉnh: "Hà Nội", "Doanh thu": 100 },
  { Ngày: "2025-09-20", Tỉnh: "Đà Nẵng", "Doanh thu": 300 },
  { Ngày: "2025-10-02", Tỉnh: "Hà Nội", "Doanh thu": 400 },
  { Ngày: "2025-10-15", Tỉnh: "Đà Nẵng", "Doanh thu": 100 },
  { Ngày: "2025-10-20", Tỉnh: "Huế", "Doanh thu": 200 },
  { Ngày: "2025-11-02", Tỉnh: "Hà Nội", "Doanh thu": 9999 }, // sau kỳ: không được có trong biểu đồ
];
const sum = { column: "Doanh thu", aggregation: "sum" as const };
const box = { x: 0, y: 0, w: 400, h: 200 };

function doc(widgets: unknown[]) {
  return Dashboard.parse({
    schemaVersion: 1, id: "d", name: "D", canvas: { width: 1000, height: 600, background: "#fff" },
    sources: [{
      id: "s", type: "google_sheets", spreadsheetId: "x", sheetName: "T",
      columns: [{ name: "Ngày", type: "date" }, { name: "Tỉnh", type: "string" }, { name: "Doanh thu", type: "number" }],
    }],
    widgets,
  });
}
const kpiW = (id: string, y = 0, over: Record<string, unknown> = {}) =>
  ({ id, ...box, y, ...over, config: { kind: "kpi", sourceId: "s", metric: sum, title: `KPI ${id}` } });
const chartW = (id: string, y: number, chartType: string, dimensions: unknown[], over: Record<string, unknown> = {}) =>
  ({ id, ...box, y, ...over, config: { kind: "chart", chartType, sourceId: "s", dimensions, metrics: [sum], title: `Chart ${id}` } });

describe("pickImageWidgets", () => {
  const d = doc([
    chartW("c2", 200, "bar", [{ column: "Tỉnh" }]),
    chartW("c1", 100, "line", [{ column: "Ngày", grain: "month" }]),
    chartW("tbl", 0, "table", [{ column: "Tỉnh" }]),
    chartW("hid", 50, "bar", [{ column: "Tỉnh" }], { hidden: true }),
    kpiW("k1", 10),
    { id: "t", ...box, config: { kind: "text", text: "x", fontSize: 16, bold: false, align: "left" } },
  ]);
  it("tự chọn: chỉ biểu đồ (không bảng/ẩn/KPI/văn bản) theo thứ tự đọc", () => {
    expect(pickImageWidgets(d, []).map((w) => w.id)).toEqual(["c1", "c2"]);
  });
  it("chọn tay: đúng thứ tự đã chọn, nhận cả KPI, bỏ id lạ/ẩn/bảng/văn bản/trùng", () => {
    expect(pickImageWidgets(d, ["k1", "c2", "nope", "hid", "tbl", "t", "k1", "c1"]).map((w) => w.id)).toEqual(["k1", "c2", "c1"]);
  });
  it("tối đa 6 ảnh", () => {
    const many = doc(Array.from({ length: 9 }, (_, i) => chartW(`c${i}`, i, "bar", [{ column: "Tỉnh" }])));
    expect(pickImageWidgets(many, [])).toHaveLength(MAX_IMAGES);
    expect(pickImageWidgets(many, many.widgets.map((w) => w.id))).toHaveLength(MAX_IMAGES);
  });
});

describe("renderReportImages", () => {
  const specs: QuerySpec[] = [];
  const exec: Executor = async (_id, spec) => {
    specs.push(spec);
    return runQuery(rows, spec);
  };

  it("vẽ biểu đồ cột, biểu đồ thời gian và thẻ KPI thành PNG 600px; cid duy nhất", async () => {
    specs.length = 0;
    const d = doc([
      kpiW("k1", 0),
      chartW("c1", 100, "line", [{ column: "Ngày", grain: "month" }]),
      chartW("c2", 200, "bar", [{ column: "Tỉnh" }]),
    ]);
    const facts = await buildReportFacts({ doc: d, periods, exec });
    specs.length = 0;
    const r = await renderReportImages({ doc: d, facts, periods, exec, widgetIds: ["k1", "c1", "c2"] });
    expect(r.notes).toEqual([]);
    expect(r.images.map((i) => i.widgetId)).toEqual(["k1", "c1", "c2"]);
    expect(new Set(r.images.map((i) => i.cid)).size).toBe(3);
    for (const i of r.images) {
      expect(isPng(i.png)).toBe(true);
      expect(i.width).toBe(IMAGE_WIDTH);
      expect(i.png.length).toBeGreaterThan(2000);
      expect(i.cid).toMatch(/^chart-\d+@cerno\.report$/);
    }
    expect(r.images.reduce((n, i) => n + i.png.length, 0)).toBeLessThan(1_500_000);
    expect(r.images.map((i) => i.title)).toEqual(["KPI k1", "Chart c1", "Chart c2"]);
  });

  it("biểu đồ theo nhóm chỉ lấy dữ liệu TRONG kỳ; biểu đồ theo thời gian lấy lịch sử đến hết kỳ (không có cận dưới)", async () => {
    const d = doc([
      chartW("c1", 100, "line", [{ column: "Ngày", grain: "month" }]),
      chartW("c2", 200, "bar", [{ column: "Tỉnh" }]),
    ]);
    const facts = await buildReportFacts({ doc: d, periods, exec });
    specs.length = 0;
    await renderReportImages({ doc: d, facts, periods, exec, widgetIds: [] });
    const range = (i: number) => (specs[i] as Extract<QuerySpec, { mode: "aggregate" }>).filters[0].dateRange;
    expect(range(0)).toEqual({ to: "2025-10-31" }); // thời gian: không có from
    expect(range(1)).toEqual({ from: "2025-10-01", to: "2025-10-31" }); // nhóm: đúng kỳ
  });

  it("không có dữ liệu trong kỳ → bỏ ảnh đó và ghi chú, ảnh khác vẫn có", async () => {
    const d = doc([chartW("c1", 0, "bar", [{ column: "Tỉnh" }]), chartW("c2", 100, "bar", [{ column: "Tỉnh" }])]);
    const facts = await buildReportFacts({ doc: d, periods, exec });
    let n = 0;
    const flaky: Executor = async (id, spec) => (n++ === 0 ? runQuery([], spec) : exec(id, spec));
    const r = await renderReportImages({ doc: d, facts, periods, exec: flaky, widgetIds: [] });
    expect(r.images.map((i) => i.widgetId)).toEqual(["c2"]);
    expect(r.notes.join("|")).toMatch(/Chart c1.*không có dữ liệu/);
  });

  it("một ảnh bị lỗi (truy vấn ném lỗi) không làm hỏng cả báo cáo", async () => {
    const d = doc([chartW("c1", 0, "bar", [{ column: "Tỉnh" }]), chartW("c2", 100, "bar", [{ column: "Tỉnh" }])]);
    const facts = await buildReportFacts({ doc: d, periods, exec });
    let n = 0;
    const boom: Executor = async (id, spec) => {
      if (n++ === 0) throw new Error("mất kết nối DB");
      return exec(id, spec);
    };
    const r = await renderReportImages({ doc: d, facts, periods, exec: boom, widgetIds: [] });
    expect(r.images.map((i) => i.widgetId)).toEqual(["c2"]);
    expect(r.notes.join("|")).toMatch(/Không vẽ được ảnh cho widget c1/);
    expect(r.notes.join("|")).not.toContain("mất kết nối"); // không lộ chi tiết lỗi vào báo cáo
  });

  it("thẻ KPI không có trong facts thì ghi chú, không vẽ", async () => {
    const d = doc([kpiW("k1")]);
    const facts = await buildReportFacts({ doc: d, periods, exec });
    const r = await renderReportImages({ doc: d, facts: { ...facts, kpis: [] }, periods, exec, widgetIds: ["k1"] });
    expect(r.images).toEqual([]);
    expect(r.notes.join("|")).toMatch(/KPI k1|KPI KPI k1/);
  });

  it("tiêu đề biểu đồ chứa ký tự đặc biệt vẫn vẽ được", async () => {
    const d = doc([chartW("c1", 0, "bar", [{ column: "Tỉnh" }], { config: undefined })]);
    d.widgets[0].config = { ...d.widgets[0].config, title: `<b>"Doanh thu" & 'Hà Nội'</b>` } as typeof d.widgets[0]["config"];
    const facts = await buildReportFacts({ doc: d, periods, exec });
    const r = await renderReportImages({ doc: d, facts, periods, exec, widgetIds: [] });
    expect(r.images).toHaveLength(1);
    expect(isPng(r.images[0].png)).toBe(true);
  });
});
