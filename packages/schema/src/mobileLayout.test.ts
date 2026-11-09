import { describe, expect, it } from "vitest";
import { Dashboard, deriveMobileLayout, mobileFontSize, mobileKpiTitleSize, mobileKpiValueSize, mobileChartFormat } from "./index";

const chart = (id: string, x: number, y: number, w = 400, h = 300, extra: object = {}) => ({
  id, x, y, w, h, ...extra,
  config: { kind: "chart", chartType: "bar", sourceId: "s1" },
});

const make = (widgets: unknown[]) =>
  Dashboard.parse({
    schemaVersion: 1,
    id: "d",
    name: "t",
    canvas: { width: 1440, height: 900 },
    widgets,
  });

const ids = (d: ReturnType<typeof make>) => deriveMobileLayout(d).map((i) => i.widgetId);

describe("deriveMobileLayout", () => {
  it("xếp trên→dưới, cùng hàng thì trái→phải", () => {
    const d = make([chart("c", 50, 500), chart("b", 600, 20), chart("a", 50, 10)]);
    expect(ids(d)).toEqual(["a", "b", "c"]);
  });

  it("bỏ widget ẩn trên desktop hoặc mobile", () => {
    const d = make([
      chart("a", 0, 0),
      chart("b", 0, 400, 400, 300, { hidden: true }),
      chart("c", 0, 800, 400, 300, { mobile: { hidden: true } }),
    ]);
    expect(ids(d)).toEqual(["a"]);
  });

  it("order thủ công được ưu tiên", () => {
    const d = make([chart("a", 0, 0), chart("b", 0, 400, 400, 300, { mobile: { order: 0 } })]);
    expect(ids(d)).toEqual(["b", "a"]);
  });

  it("chart: giữ tỉ lệ nhưng giới hạn trong [200, 420]", () => {
    const d = make([chart("tall", 0, 0, 100, 2000), chart("flat", 0, 3000, 1000, 10)]);
    const [tall, flat] = deriveMobileLayout(d);
    expect(tall.height).toBe(420);
    expect(flat.height).toBe(200);
  });

  it("KPI gọn: không bị kéo cao theo bề ngang, kẹp trong [84, 104]", () => {
    const kpi = (id: string, h: number, y: number) =>
      ({ id, x: 0, y, w: 220, h, config: { kind: "kpi", sourceId: "s", metric: { column: "a" } } });
    const [a, b, c] = deriveMobileLayout(make([kpi("a", 110, 0), kpi("b", 400, 500), kpi("c", 30, 1000)]));
    expect([a.height, b.height, c.height]).toEqual([104, 104, 84]);
  });

  it("ảnh/logo nhỏ không bị phóng thành cả màn hình; banner rộng thì dẹt", () => {
    const img = (id: string, w: number, h: number, y: number) => ({ id, x: 0, y, w, h, config: { kind: "image", url: "x" } });
    const [logo, banner] = deriveMobileLayout(make([img("logo", 240, 160, 0), img("banner", 1200, 300, 500)]));
    expect(logo.height).toBe(160); // = kích thước thiết kế, không phải 390 * 160/240
    expect(banner.height).toBe(98); // 390 * 300/1200 (bề ngang mặc định 390)
  });

  it("cỡ chữ mobile: thu theo bề ngang, kẹp trong [14, 30]", () => {
    expect(mobileFontSize(28, 360, 366)).toBe(28); // vừa khung thì giữ nguyên
    expect(mobileFontSize(56, 700, 366)).toBe(29); // tiêu đề to trên khung rộng được thu lại
    expect(mobileFontSize(20, 1400, 366)).toBe(14); // không nhỏ hơn 14px
    expect(mobileFontSize(120, 366, 366)).toBe(30); // không lớn hơn 30px
  });

  it("chữ biểu đồ/bảng trên mobile: kẹp trần, không nâng cỡ nhỏ lên, giữ màu và kiểu", () => {
    const f = mobileChartFormat({
      title: { fontSize: 40, color: "#ff0000", bold: true },
      axis: { fontSize: 20 },
      legend: { fontSize: 9 },
      tableCell: { fontSize: 18 },
      showGrid: false,
    });
    expect(f?.title).toEqual({ fontSize: 16, color: "#ff0000", bold: true });
    expect(f?.axis?.fontSize).toBe(11);
    expect(f?.legend?.fontSize).toBe(9); // đã nhỏ hơn trần thì giữ nguyên
    expect(f?.tableCell?.fontSize).toBe(12);
    expect(f?.showGrid).toBe(false);
    expect(mobileChartFormat(undefined)).toBeUndefined();
  });

  it("KPI mobile: số tự theo chiều cao, cỡ tuỳ chỉnh chỉ được nhỏ hơn", () => {
    expect(mobileKpiValueSize(100)).toBe(40);
    expect(mobileKpiValueSize(60)).toBe(26);
    expect(mobileKpiValueSize(100, 120)).toBe(40);
    expect(mobileKpiValueSize(100, 30)).toBe(30);
    expect(mobileKpiTitleSize()).toBe(13);
    expect(mobileKpiTitleSize(40)).toBe(14);
  });

  it("text: chiều cao theo số dòng (kể cả dòng bị xuống hàng), không theo tỉ lệ khung", () => {
    const text = (id: string, t: string, y: number, fontSize = 20) => ({
      id, x: 0, y, w: 366, h: 56, config: { kind: "text", text: t, fontSize },
    });
    const [one, two, long] = deriveMobileLayout(make([
      text("a", "Tiêu đề", 0),
      text("b", "Dòng 1\nDòng 2", 100),
      text("c", "Một đoạn văn bản rất dài ".repeat(8), 200),
    ]));
    expect(one.height).toBe(38); // 1 * 20 * 1.3 + 12
    expect(two.height).toBe(64); // 2 * 20 * 1.3 + 12
    expect(long.height).toBeGreaterThan(two.height); // đoạn dài xuống nhiều dòng
  });

  it("mobile.height thủ công thắng chiều cao tự động", () => {
    const d = make([chart("a", 0, 0, 400, 300, { mobile: { height: 333 } })]);
    expect(deriveMobileLayout(d)[0].height).toBe(333);
  });
});
