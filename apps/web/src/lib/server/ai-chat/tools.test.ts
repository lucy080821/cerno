import { describe, expect, it } from "vitest";
import { runQuery, type Row } from "@dashboard/chart-engine";
import { COL } from "@/lib/orders/canonical";
import { buildOrders, summarize } from "@/lib/profit/order-profit";
import { inRange } from "@/lib/profit/period";
import { runTool, toolDefs, type ProfitData, type ToolDeps } from "./tools";
import type { SourceInfo } from "./sources";

const sheetCols = [
  { name: "Kênh", type: "string" },
  { name: "Ngày", type: "date" },
  { name: "Doanh thu", type: "number", unit: "đồng" },
  { name: "Số đơn", type: "number", unit: "đơn" },
];
const sheetRows: Row[] = [
  { Kênh: "Shopee", Ngày: "2026-10-05", "Doanh thu": 100_000, "Số đơn": 1 },
  { Kênh: "Shopee", Ngày: "2026-10-20", "Doanh thu": 300_000, "Số đơn": 3 },
  { Kênh: "TikTok Shop", Ngày: "2026-11-02", "Doanh thu": 200_000, "Số đơn": 2 },
  { Kênh: "Lazada", Ngày: "2026-11-10", "Doanh thu": 400_000, "Số đơn": 4 },
];
const sheet: SourceInfo = { alias: "s1", id: "11111111-1111-1111-1111-111111111111", name: "Sổ bán hàng", kind: "sheet", columns: sheetCols, rowCount: sheetRows.length, syncedAt: null, workspaceId: "w" };

const orderRow = (o: Partial<Record<string, string | number | null>>): Row => ({
  [COL.channel]: "Shopee", [COL.orderId]: "A", [COL.date]: "2026-11-02 10:00", [COL.status]: "Hoàn thành", [COL.rawStatus]: "Hoàn thành",
  [COL.sku]: "SKU1", [COL.product]: "Áo", [COL.variant]: null, [COL.quantity]: 1, [COL.revenue]: 100_000, [COL.netRevenue]: 100_000,
  [COL.orders]: 1, [COL.cancelledOrders]: 0, [COL.platformFee]: 10_000, [COL.province]: null, [COL.payment]: null,
  [COL.discount]: null, [COL.shippingFee]: null, [COL.cost]: 40_000, [COL.adCost]: null, ...o,
});
const orderRows: Row[] = [
  orderRow({ [COL.orderId]: "A1" }), // lãi 50.000
  orderRow({ [COL.orderId]: "A2", [COL.sku]: "SKU2", [COL.product]: "Quần", [COL.cost]: 95_000 }), // lỗ 5.000
  orderRow({ [COL.orderId]: "T1", [COL.channel]: "TikTok Shop", [COL.date]: "2026-10-15 09:00", [COL.platformFee]: 20_000 }), // lãi 40.000
  orderRow({ [COL.orderId]: "A3", [COL.sku]: "SKU3", [COL.product]: "Mũ", [COL.cost]: null }), // thiếu giá vốn
];
const orders = buildOrders(orderRows);
const orderSource: SourceInfo = { alias: "s2", id: "22222222-2222-2222-2222-222222222222", name: "Đơn hàng đa kênh", kind: "orders", columns: [{ name: COL.channel, type: "string" }, { name: COL.date, type: "date" }], rowCount: orderRows.length, syncedAt: null, workspaceId: "w" };

const deps: ToolDeps = {
  query: async (id, spec) => runQuery(id === sheet.id ? sheetRows : orderRows, spec),
  profit: async (_s, range): Promise<ProfitData> => {
    const list = range ? orders.filter((o) => inRange(o.date, range)) : orders;
    return { orders: list, summary: summarize(list), dataMin: "2026-10-15", dataMax: "2026-11-02" };
  },
};
const call = async (name: string, args: unknown, sources = [sheet, orderSource]) => runTool(name, JSON.stringify(args), sources, deps);
const parse = (r: { content: string }) => JSON.parse(r.content);

describe("query_data", () => {
  it("nhóm theo cột chữ: bảng, tổng chung và tỷ trọng đã tính sẵn", async () => {
    const r = await call("query_data", { source: "s1", group_by: [{ column: "Kênh" }], metrics: [{ column: "Doanh thu", agg: "sum" }] });
    expect(r.ok).toBe(true);
    const j = parse(r);
    expect(j.matched_rows).toBe(4);
    expect(j.groups).toBe(3);
    expect(j.rows[0]).toEqual(["Shopee", 400_000]); // Shopee = 400.000 bằng Lazada: sắp giảm dần, hòa thì giữ thứ tự gặp
    expect(j.overall).toEqual([1_000_000]);
    expect(j.units).toEqual(["đồng"]);
    const total = (j.share_pct[0] as number[]).reduce((a, b) => a + b, 0);
    expect(Math.round(total)).toBe(100);
  });

  it("cột ngày phải có grain; có grain thì sắp theo thời gian", async () => {
    const bad = await call("query_data", { source: "s1", group_by: [{ column: "Ngày" }], metrics: [{ column: "Doanh thu" }] });
    expect(bad.ok).toBe(false);
    expect(bad.content).toMatch(/cần grain/);
    const ok = await call("query_data", { source: "s1", group_by: [{ column: "Ngày", grain: "month" }], metrics: [{ column: "Doanh thu" }] });
    expect(parse(ok).rows).toEqual([["2026-10", 400_000], ["2026-11", 600_000]]);
  });

  it("số đo dạng công thức (tỷ số) do máy tính, không để AI tự chia", async () => {
    const r = await call("query_data", { source: "s1", metrics: [{ formula: "SUM([Doanh thu]) / SUM([Số đơn])", name: "Doanh thu mỗi đơn" }] });
    expect(parse(r).overall).toEqual([100_000]);
    expect(parse(r).metrics).toEqual(["Doanh thu mỗi đơn"]);
    const wrong = await call("query_data", { source: "s1", metrics: [{ formula: "SUM([Không có]) / 2", name: "x" }] });
    expect(wrong.ok).toBe(false);
    expect(wrong.content).toMatch(/\[Không có\]/);
    const noAgg = await call("query_data", { source: "s1", metrics: [{ formula: "[Doanh thu] / [Số đơn]", name: "y" }] });
    expect(noAgg.content).toMatch(/hàm tổng hợp/);
  });

  it("bộ lọc theo giá trị, theo khoảng ngày; lọc sai kiểu cột bị báo lỗi", async () => {
    const byValue = await call("query_data", { source: "s1", metrics: [{ column: "Doanh thu" }], filters: [{ column: "Kênh", values: ["Shopee"] }] });
    expect(parse(byValue).overall).toEqual([400_000]);
    const byDate = await call("query_data", { source: "s1", metrics: [{ column: "Doanh thu" }], filters: [{ column: "Ngày", from: "2026-11-01", to: "2026-11-30" }] });
    expect(parse(byDate).overall).toEqual([600_000]);
    expect(parse(byDate).matched_rows).toBe(2);
    const wrong = await call("query_data", { source: "s1", metrics: [{ column: "Doanh thu" }], filters: [{ column: "Kênh", min: 1 }] });
    expect(wrong.content).toMatch(/không phải cột số/);
  });

  it("tên cột lệch hoa thường/dấu được tự sửa; cột không có thì gợi ý các cột đúng", async () => {
    const fixed = await call("query_data", { source: "s1", group_by: [{ column: "kenh" }], metrics: [{ column: "doanh thu" }] });
    expect(fixed.ok).toBe(true);
    const bad = await call("query_data", { source: "s1", metrics: [{ column: "Lợi nhuận" }] });
    expect(bad.ok).toBe(false);
    expect(bad.content).toMatch(/không có cột "Lợi nhuận".*Doanh thu/);
  });

  it("không cộng cột chữ; không có nguồn thì báo các nguồn đang chọn", async () => {
    expect((await call("query_data", { source: "s1", metrics: [{ column: "Kênh", agg: "sum" }] })).content).toMatch(/không tính tổng/);
    expect((await call("query_data", { source: "s9", metrics: [{ column: "Doanh thu" }] })).content).toMatch(/Các nguồn đang chọn: s1/);
  });

  it("giới hạn số dòng và báo phần bị ẩn đã nằm trong tổng chung", async () => {
    const r = await call("query_data", { source: "s1", group_by: [{ column: "Kênh" }], metrics: [{ column: "Doanh thu" }], limit: 2 });
    expect(parse(r).rows).toHaveLength(2);
    expect(parse(r).note).toMatch(/2\/3 nhóm/);
  });
});

describe("column_info và sample_rows", () => {
  it("liệt kê giá trị khác nhau, khoảng số và khoảng ngày", async () => {
    const c = parse(await call("column_info", { source: "s1", column: "Kênh" }));
    expect(c.distinct_values.sort()).toEqual(["Lazada", "Shopee", "TikTok Shop"]);
    const d = parse(await call("column_info", { source: "s1", column: "Ngày" }));
    expect(d.date_range).toEqual({ min: "2026-10-05", max: "2026-11-10" });
    const n = parse(await call("column_info", { source: "s1", column: "Doanh thu" }));
    expect(n.number_range).toEqual({ min: 100_000, max: 400_000 });
  });

  it("dòng mẫu tối đa 10 dòng và chỉ các cột được hỏi", async () => {
    const r = parse(await call("sample_rows", { source: "s1", columns: ["Kênh", "Doanh thu"], limit: 10 }));
    expect(r.columns).toEqual(["Kênh", "Doanh thu"]);
    expect(r.rows).toHaveLength(4);
    expect((await call("sample_rows", { source: "s1", limit: 11 })).ok).toBe(false);
  });
});

describe("profit_report", () => {
  it("tổng lãi chỉ tính đơn đủ giá vốn và nói rõ đơn thiếu giá vốn", async () => {
    const j = parse(await call("profit_report", { source: "s2" }));
    expect(j.totals.orders).toBe(4);
    expect(j.totals.computable_orders).toBe(3);
    expect(j.totals.missing_cost_orders).toBe(1);
    expect(j.totals.profit).toBe(50_000 - 5_000 + 40_000);
    expect(j.totals.loss_orders).toBe(1);
    expect(j.notes.join(" ")).toMatch(/1 đơn hợp lệ chưa có giá vốn/);
  });

  it("lọc theo khoảng ngày và theo kênh", async () => {
    const nov = parse(await call("profit_report", { source: "s2", from: "2026-11-01", to: "2026-11-30" }));
    expect(nov.totals.orders).toBe(3);
    const tt = parse(await call("profit_report", { source: "s2", channel: "tiktok shop" }));
    expect(tt.totals.profit).toBe(40_000);
    expect(tt.scope.channel).toBe("TikTok Shop");
    expect((await call("profit_report", { source: "s2", channel: "Lazada" })).content).toMatch(/Không có kênh "Lazada".*Shopee/);
  });

  it("chia theo kênh, sản phẩm (lỗ nhiều nhất trước), tháng và lý do lỗ", async () => {
    const byChannel = parse(await call("profit_report", { source: "s2", group_by: "channel" }));
    expect(byChannel.breakdown.rows.map((r: { key: string }) => r.key)).toEqual(["Shopee", "TikTok Shop"]);
    const sum = byChannel.breakdown.rows.reduce((n: number, r: { profit: number }) => n + r.profit, 0);
    expect(sum).toBe(byChannel.totals.profit); // phần cộng lại khớp tổng
    const byProduct = parse(await call("profit_report", { source: "s2", group_by: "product", sort: "profit_asc", limit: 2 }));
    expect(byProduct.breakdown.rows[0].name).toBe("Quần");
    expect(byProduct.breakdown.rows[0].profit).toBeLessThan(0);
    expect(byProduct.breakdown.rows).toHaveLength(2);
    const byMonth = parse(await call("profit_report", { source: "s2", group_by: "month" }));
    expect(byMonth.breakdown.rows.map((r: { key: string }) => r.key)).toEqual(["2026-10", "2026-11"]);
    const reasons = parse(await call("profit_report", { source: "s2", group_by: "loss_reason" }));
    expect(Array.isArray(reasons.breakdown.rows)).toBe(true);
  });

  it("chỉ dùng được cho nguồn đơn hàng; ngày sai bị từ chối", async () => {
    expect((await call("profit_report", { source: "s1" })).content).toMatch(/không phải nguồn đơn hàng/);
    expect((await call("profit_report", { source: "s2", from: "11/2026" })).content).toMatch(/yyyy-mm-dd/);
    expect((await call("profit_report", { source: "s2", from: "2026-12-01", to: "2026-11-01" })).content).toMatch(/trước hoặc bằng/);
  });
});

describe("chạy công cụ an toàn", () => {
  it("tham số hỏng, công cụ lạ và tham số sai kiểu đều trả lỗi cho AI sửa, không ném", async () => {
    expect((await runTool("query_data", "{không phải json", [sheet], deps)).ok).toBe(false);
    expect((await runTool("xoa_het", "{}", [sheet], deps)).content).toMatch(/Không có công cụ/);
    const r = await call("query_data", { source: "s1", metrics: [] });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Tham số sai/);
  });

  it("lỗi bất ngờ của máy chủ không lộ chi tiết", async () => {
    const boom: ToolDeps = { query: async () => { throw new Error("secret db password leaked"); } };
    const r = await runTool("column_info", JSON.stringify({ source: "s1", column: "Kênh" }), [sheet], boom);
    expect(r.ok).toBe(false);
    expect(r.content).not.toMatch(/secret/);
  });

  it("chỉ có công cụ lãi khi đã chọn nguồn đơn hàng", () => {
    expect(toolDefs([]).length).toBe(0);
    expect(toolDefs([sheet]).map((t) => t.function.name)).toEqual(["query_data", "column_info", "sample_rows"]);
    expect(toolDefs([sheet, orderSource]).map((t) => t.function.name)).toContain("profit_report");
  });

  it("kết quả quá dài bị cắt gọn", async () => {
    const big: Row[] = Array.from({ length: 5000 }, (_, i) => ({ Kênh: `Kênh dài số ${i} ${"x".repeat(200)}`, "Doanh thu": i }));
    const d: ToolDeps = { query: async (_id, spec) => runQuery(big, spec) };
    const r = await runTool("query_data", JSON.stringify({ source: "s1", group_by: [{ column: "Kênh" }], metrics: [{ column: "Doanh thu" }], limit: 50 }), [sheet], d);
    expect(r.content.length).toBeLessThan(9300);
  });
});

describe("show_chart / show_kpi", () => {
  it("chỉ có trong danh sách công cụ khi bật visual", () => {
    expect(toolDefs([sheet]).map((d) => d.function.name)).not.toContain("show_chart");
    const on = toolDefs([sheet], { visual: true }).map((d) => d.function.name);
    expect(on).toEqual(expect.arrayContaining(["show_chart", "show_kpi"]));
  });

  it("vẽ biểu đồ cột theo kênh: trả hình + bảng rút gọn cho model", async () => {
    const r = await call("show_chart", { source: "s1", chart_type: "bar", title: "Doanh thu theo kênh", group_by: [{ column: "Kênh" }], metrics: [{ column: "Doanh thu", agg: "sum" }] });
    expect(r.ok).toBe(true);
    expect(r.visual).toMatchObject({ kind: "chart", chartType: "bar", title: "Doanh thu theo kênh", dimLabels: ["Kênh"], groups: 3 });
    const v = r.visual as { rows: Array<{ keys: unknown[]; values: number[] }> };
    expect(v.rows[0]).toEqual({ keys: ["Shopee"], values: [400_000] });
    expect(r.content).toContain("Đã hiển thị biểu đồ");
    expect(r.content).toContain("Tổng chung: 1000000");
  });

  it("chuỗi thời gian dài hơn limit thì giữ các mốc GẦN NHẤT, theo thứ tự thời gian", async () => {
    const r = await call("show_chart", { source: "s1", chart_type: "line", group_by: [{ column: "Ngày", grain: "month" }], metrics: [{ column: "Doanh thu", agg: "sum" }], limit: 1 });
    expect(r.ok).toBe(true);
    const v = r.visual as { rows: Array<{ keys: unknown[]; values: number[] }>; groups: number };
    expect(v.groups).toBe(2);
    expect(v.rows).toEqual([{ keys: ["2026-11"], values: [600_000] }]);
  });

  it("biểu đồ tròn chỉ nhận 1 chiều và 1 số đo: số đo thừa bị bỏ", async () => {
    const r = await call("show_chart", { source: "s1", chart_type: "pie", group_by: [{ column: "Kênh" }], metrics: [{ column: "Doanh thu", agg: "sum" }, { column: "Số đơn", agg: "sum" }] });
    expect(r.ok).toBe(true);
    expect((r.visual as { metricLabels: string[] }).metricLabels).toHaveLength(1);
  });

  it("không có dữ liệu khớp, cột sai hoặc thiếu chiều thì báo LỖI để model sửa", async () => {
    const none = await call("show_chart", { source: "s1", chart_type: "bar", group_by: [{ column: "Kênh" }], metrics: [{ column: "Doanh thu", agg: "sum" }], filters: [{ column: "Kênh", values: ["Không có"] }] });
    expect(none.ok).toBe(false);
    expect(none.content).toMatch(/^LỖI/);
    expect(none.visual).toBeUndefined();
    const badCol = await call("show_chart", { source: "s1", chart_type: "bar", group_by: [{ column: "Xyz" }], metrics: [{ column: "Doanh thu", agg: "sum" }] });
    expect(badCol.content).toMatch(/^LỖI/);
    const noDim = await call("show_chart", { source: "s1", chart_type: "bar", group_by: [], metrics: [{ column: "Doanh thu", agg: "sum" }] });
    expect(noDim.ok).toBe(false);
  });

  it("thẻ KPI: giá trị đã định dạng theo kiểu Việt/Anh kèm đơn vị, tổng đúng cả với trung bình", async () => {
    const r = await call("show_kpi", { source: "s1", title: "Tháng 10 và 11", metrics: [{ column: "Doanh thu", agg: "sum", name: "Tổng doanh thu" }, { column: "Số đơn", agg: "sum" }, { column: "Doanh thu", agg: "avg", name: "Doanh thu trung bình" }] });
    expect(r.ok).toBe(true);
    const v = r.visual as { cards: Array<{ label: string; value: number | null; text: string }>; title?: string };
    expect(v.title).toBe("Tháng 10 và 11");
    expect(v.cards.map((c) => c.value)).toEqual([1_000_000, 10, 250_000]);
    expect(v.cards[0].text).toBe("1.000.000 đồng");
    expect(v.cards[1].text).toBe("10 đơn");
    const en = await runTool("show_kpi", JSON.stringify({ source: "s1", metrics: [{ column: "Doanh thu", agg: "sum" }] }), [sheet], { ...deps, lang: "en" });
    expect((en.visual as { cards: Array<{ text: string }> }).cards[0].text).toBe("1,000,000 đồng");
  });

  it("thẻ KPI không có dòng nào khớp: giá trị trống, không ném lỗi", async () => {
    const r = await call("show_kpi", { source: "s1", metrics: [{ column: "Doanh thu", agg: "avg" }], filters: [{ column: "Kênh", values: ["Không có"] }] });
    expect(r.ok).toBe(true);
    expect((r.visual as { cards: Array<{ value: number | null; text: string }> }).cards[0]).toMatchObject({ value: null, text: "—" });
  });
});
