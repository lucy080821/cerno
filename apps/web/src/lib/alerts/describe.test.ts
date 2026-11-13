import { describe, expect, it } from "vitest";
import { AlertDraft, AlertMetric } from "@dashboard/schema";
import { conditionSentence, metricLabel, thresholdText } from "./describe";

const draft = (m: Record<string, unknown>, condition: unknown) =>
  AlertDraft.parse({ metric: { sourceId: "s", metric: { column: "Doanh thu", aggregation: "sum" }, dateColumn: "Ngày", window: "today", ...m }, condition });

describe("metricLabel", () => {
  it("gộp + tên cột; trường tính toán chỉ dùng tên; nhãn tự đặt được ưu tiên", () => {
    expect(metricLabel(draft({}, { type: "threshold", op: "lt", value: 1 }).metric)).toBe("Tổng Doanh thu");
    expect(metricLabel(draft({ metric: { column: "Mã đơn", aggregation: "count_distinct" } }, { type: "threshold", op: "lt", value: 1 }).metric)).toBe("Số giá trị khác nhau Mã đơn");
    expect(metricLabel(draft({ metric: { column: "Biên" } }, { type: "threshold", op: "lt", value: 1 }).metric, ["Biên"])).toBe("Biên");
    expect(metricLabel(draft({ metric: { column: "DT", label: "Doanh số" } }, { type: "threshold", op: "lt", value: 1 }).metric)).toBe("Doanh số");
  });
});

describe("conditionSentence", () => {
  const win = "hôm nay (13/11/2025)";
  const s = (cond: unknown, m: Record<string, unknown> = {}, o = {}) => {
    const d = draft(m, cond);
    return conditionSentence(d.condition, d.metric, win, o);
  };
  it("ngưỡng", () => {
    expect(s({ type: "threshold", op: "lt", value: 10_000_000 })).toBe("Tổng Doanh thu hôm nay (13/11/2025) thấp hơn 10.000.000");
    expect(s({ type: "threshold", op: "gte", value: 5 })).toContain("cao hơn hoặc bằng 5");
    expect(s({ type: "threshold", op: "lte", value: 5 })).toContain("thấp hơn hoặc bằng 5");
    expect(s({ type: "threshold", op: "gt", value: 5 })).toContain("cao hơn 5");
  });
  it("thay đổi so với kỳ trước/cùng kỳ năm ngoái/nhãn kỳ cụ thể", () => {
    expect(s({ type: "change", op: "drop_pct", value: 20, vs: "prev_period" }, { window: "yesterday" })).toBe("Tổng Doanh thu hôm nay (13/11/2025) giảm từ 20% trở lên so với kỳ trước");
    expect(s({ type: "change", op: "rise_pct", value: 15.5, vs: "prev_year" }, { window: "yesterday" })).toContain("tăng từ 15,5% trở lên so với cùng kỳ năm ngoái");
    expect(s({ type: "change", op: "drop_pct", value: 20, vs: "prev_period" }, { window: "yesterday" }, { prevLabel: "hôm qua (12/11/2025)" })).toContain("so với hôm qua (12/11/2025)");
  });
  it("bất thường theo hướng", () => {
    const c = (direction: string) => ({ type: "anomaly", sensitivity: "medium", lookback: 8, direction });
    expect(s(c("up"), { window: "yesterday" })).toContain("tăng bất thường so với các kỳ trước cùng loại");
    expect(s(c("down"), { window: "yesterday" })).toContain("giảm bất thường");
    expect(s(c("both"), { window: "yesterday" })).toContain("tăng hoặc giảm bất thường");
  });
  it("theo từng nhóm và không có dữ liệu mới", () => {
    expect(s({ type: "per_group", inner: { type: "threshold", op: "lt", value: 100 } }, { groupBy: "Tỉnh" })).toBe("Theo từng Tỉnh: Tổng Doanh thu hôm nay (13/11/2025) thấp hơn 100");
    expect(s({ type: "stale", hours: 24 })).toBe("Không có dữ liệu mới trong 24 giờ");
  });
});

describe("thresholdText", () => {
  it("ngưỡng đơn lẻ có chữ; luật bất thường/stale thì null; per_group lấy điều kiện bên trong", () => {
    expect(thresholdText({ type: "threshold", op: "lt", value: 1000 })).toBe("thấp hơn 1.000");
    expect(thresholdText({ type: "change", op: "drop_pct", value: 20, vs: "prev_period" })).toBe("giảm từ 20%");
    expect(thresholdText({ type: "anomaly", sensitivity: "low", lookback: 4, direction: "both" })).toBeNull();
    expect(thresholdText({ type: "stale", hours: 3 })).toBeNull();
    expect(thresholdText({ type: "per_group", inner: { type: "threshold", op: "gt", value: 2 } })).toBe("cao hơn 2");
  });
});

describe("bản tiếng Anh (email song ngữ)", () => {
  const m = AlertMetric.parse({ sourceId: "s", metric: { column: "Doanh thu", aggregation: "sum" }, dateColumn: "Ngày", window: "today" });
  it("ngưỡng, thay đổi %, bất thường, không có dữ liệu mới", () => {
    expect(conditionSentence({ type: "threshold", op: "lt", value: 10_000_000 }, m, "today (13/11/2025)", { lang: "en" }))
      .toBe("Total Doanh thu today (13/11/2025) is below 10.000.000");
    expect(conditionSentence({ type: "change", op: "drop_pct", value: 20, vs: "prev_period" }, m, "this week (10/11 – 13/11/2025)", { lang: "en" }))
      .toBe("Total Doanh thu this week (10/11 – 13/11/2025) fell by 20% or more compared with the previous period");
    expect(conditionSentence({ type: "anomaly", sensitivity: "medium", lookback: 8, direction: "up" } as never, m, "today (13/11/2025)", { lang: "en" }))
      .toBe("Total Doanh thu today (13/11/2025) rose unusually compared with previous periods of the same kind");
    expect(conditionSentence({ type: "stale", hours: 24 }, m, "", { lang: "en" })).toBe("No new data for 24 hours");
  });
  it("theo từng nhóm và ngưỡng dạng chữ", () => {
    const g = { ...m, groupBy: "Tỉnh" };
    expect(conditionSentence({ type: "per_group", inner: { type: "threshold", op: "gt", value: 5 } }, g, "today (13/11/2025)", { lang: "en" }))
      .toBe("Per Tỉnh: Total Doanh thu today (13/11/2025) is above 5");
    expect(thresholdText({ type: "threshold", op: "lt", value: 10 }, "en")).toBe("below 10");
    expect(thresholdText({ type: "change", op: "rise_pct", value: 30, vs: "prev_period" }, "en")).toBe("rise of 30% or more");
  });
  it("mặc định vẫn là tiếng Việt", () => {
    expect(thresholdText({ type: "threshold", op: "lt", value: 10 })).toBe("thấp hơn 10");
  });
});
