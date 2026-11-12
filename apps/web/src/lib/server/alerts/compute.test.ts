import { describe, expect, it } from "vitest";
import { AlertDraft } from "@dashboard/schema";
import { runQuery, type CalcFieldDef, type QuerySpec, type Row } from "@dashboard/chart-engine";
import { computeAlert, computeSeries, summarize, verdictOf, type ComputeDeps } from "./compute";

/** Thời điểm theo giờ VN. 13/11/2025 là thứ Năm. */
const vn = (y: number, m: number, d: number, h = 22) => new Date(Date.UTC(y, m - 1, d, h - 7));
const NOW = vn(2025, 11, 13);

const metric = { column: "DT", aggregation: "sum" as const };
const draft = (m: Record<string, unknown>, condition: unknown) =>
  AlertDraft.parse({ metric: { sourceId: "s", metric, dateColumn: "Ngày", window: "today", ...m }, condition });

function deps(rows: Row[], over: Partial<ComputeDeps> = {}, specs: QuerySpec[] = []): ComputeDeps {
  return { exec: async (_id, spec) => { specs.push(spec); return runQuery(rows, spec); }, calc: [], now: NOW, ...over };
}
const run = (rows: Row[], d: ReturnType<typeof draft>, over: Partial<ComputeDeps> = {}) =>
  computeAlert(d.metric, d.condition as never, deps(rows, over));

const day = (iso: string, dt: number, extra: Record<string, unknown> = {}): Row => ({ Ngày: iso, DT: dt, ...extra }) as Row;

describe("threshold", () => {
  const rows = [day("2025-11-13", 4_000_000), day("2025-11-13", 3_000_000), day("2025-11-12", 50_000_000)];

  it("'doanh thu hôm nay dưới 10 triệu' → báo (7 triệu < 10 triệu), chỉ tính các dòng của hôm nay", async () => {
    const r = await run(rows, draft({}, { type: "threshold", op: "lt", value: 10_000_000 }));
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.evaluation).toMatchObject({ verdict: "firing", value: 7_000_000 });
    expect(r.info.label).toBe("hôm nay (13/11/2025)");
  });

  it("đủ ngưỡng thì không báo", async () => {
    const r = await run([...rows, day("2025-11-13", 5_000_000)], draft({}, { type: "threshold", op: "lt", value: 10_000_000 }));
    expect(r.kind === "single" && r.evaluation.verdict).toBe("ok");
  });

  it("hôm nay chưa có dòng nào: tổng là 0 (số thật) nên 'dưới ngưỡng' báo", async () => {
    const r = await run([day("2025-11-12", 50)], draft({}, { type: "threshold", op: "lt", value: 10 }));
    expect(r.kind === "single" && r.evaluation).toMatchObject({ verdict: "firing", value: 0 });
  });

  it("trung bình trên khoảng rỗng là 'không có dữ liệu', không phải 0", async () => {
    const d = draft({ metric: { column: "DT", aggregation: "avg" } }, { type: "threshold", op: "lt", value: 10 });
    const r = await run([day("2025-11-12", 50)], d);
    expect(r.kind === "single" && r.evaluation).toMatchObject({ verdict: "insufficient", reason: "no_data" });
  });

  it("bộ lọc của luật được áp (chỉ tính Hà Nội)", async () => {
    const data = [day("2025-11-13", 100, { Tỉnh: "Hà Nội" }), day("2025-11-13", 900, { Tỉnh: "Huế" })];
    const d = draft({ filters: [{ column: "Tỉnh", values: ["Hà Nội"] }] }, { type: "threshold", op: "gte", value: 100 });
    const r = await run(data, d);
    expect(r.kind === "single" && r.evaluation).toMatchObject({ verdict: "firing", value: 100 });
  });

  it("window=all không cần cột ngày: tính toàn bộ", async () => {
    const d = draft({ window: "all", dateColumn: undefined }, { type: "threshold", op: "gt", value: 5 });
    const r = await run([day("2020-01-01", 3), day("2025-01-01", 4)], d);
    expect(r.kind === "single" && r.evaluation).toMatchObject({ verdict: "firing", value: 7 });
  });

  it("dùng trường tính toán dạng tổng hợp làm chỉ số", async () => {
    const calc: CalcFieldDef[] = [{ id: "c", name: "Biên", expression: "SUM([LN]) / SUM([DT])" }];
    const data = [day("2025-11-13", 100, { LN: 10 }), day("2025-11-13", 100, { LN: 20 })];
    const d = draft({ metric: { column: "Biên" } }, { type: "threshold", op: "lt", value: 0.2 });
    const r = await run(data, d, { calc });
    expect(r.kind === "single" && r.evaluation).toMatchObject({ verdict: "firing", value: 0.15 }); // 30/200 = 15% < 20%
  });
});

describe("settleHour: khoảng chưa kết thúc", () => {
  const rows = [day("2025-11-13", 1)];
  const d = draft({ settleHour: 21 }, { type: "threshold", op: "lt", value: 10 });
  it("trước giờ chốt: hoãn đánh giá", async () => {
    const r = await computeAlert(d.metric, d.condition as never, deps(rows, { now: vn(2025, 11, 13, 20) }));
    expect(r).toMatchObject({ kind: "deferred", settleHour: 21 });
    expect(verdictOf(r)).toBe("deferred");
  });
  it("từ giờ chốt: đánh giá bình thường", async () => {
    const r = await computeAlert(d.metric, d.condition as never, deps(rows, { now: vn(2025, 11, 13, 21) }));
    expect(r.kind === "single" && r.evaluation.verdict).toBe("firing");
  });
  it("khoảng đã trọn (hôm qua) thì bỏ qua settleHour", async () => {
    const d2 = draft({ window: "yesterday", settleHour: 23 }, { type: "threshold", op: "lt", value: 10 });
    const r = await computeAlert(d2.metric, d2.condition as never, deps([day("2025-11-12", 1)], { now: vn(2025, 11, 13, 5) }));
    expect(r.kind).toBe("single");
  });
});

describe("change", () => {
  const rows = [day("2025-11-12", 1000), day("2025-11-11", 1000), day("2025-11-10", 1000)];
  it("hôm qua giảm 30% so với hôm kia → báo (giảm ≥ 20%)", async () => {
    const data = [day("2025-11-12", 700), day("2025-11-11", 1000)];
    const r = await run(data, draft({ window: "yesterday" }, { type: "change", op: "drop_pct", value: 20, vs: "prev_period" }));
    expect(r.kind === "single" && r.evaluation).toMatchObject({ verdict: "firing", value: 700, prev: 1000, changePct: -30 });
    expect(r.kind === "single" && r.info.prevLabel).toBe("hôm qua (11/11/2025)");
  });
  it("kỳ trước không có dòng nào → không có mốc, không báo", async () => {
    const r = await run([day("2025-11-12", 700)], draft({ window: "yesterday" }, { type: "change", op: "drop_pct", value: 20, vs: "prev_period" }));
    expect(r.kind === "single" && r.evaluation).toMatchObject({ verdict: "insufficient", reason: "no_base" });
  });
  it("so với cùng kỳ năm ngoái", async () => {
    const data = [day("2025-11-12", 150), day("2024-11-12", 100)];
    const r = await run(data, draft({ window: "yesterday" }, { type: "change", op: "rise_pct", value: 40, vs: "prev_year" }));
    expect(r.kind === "single" && r.evaluation).toMatchObject({ verdict: "firing", changePct: 50 });
  });
  it("7 ngày qua so với 7 ngày liền trước", async () => {
    const data = [day("2025-11-10", 600), day("2025-11-03", 1000)]; // T6 kỳ này: 06–12/11, kỳ trước: 30/10–05/11
    const r = await run(data, draft({ window: "last_7d" }, { type: "change", op: "drop_pct", value: 10, vs: "prev_period" }));
    expect(r.kind === "single" && r.evaluation).toMatchObject({ verdict: "firing", value: 600, prev: 1000 });
    expect(rows.length).toBe(3);
  });
});

describe("anomaly", () => {
  /** Các thứ Tư (hôm qua = 12/11 là thứ Tư): 5/11, 29/10, 22/10, 15/10, 8/10, 1/10... mỗi ngày một dòng. */
  const wednesdays = ["2025-11-05", "2025-10-29", "2025-10-22", "2025-10-15", "2025-10-08", "2025-10-01"];
  const base = (vals: number[]) => wednesdays.map((d, i) => day(d, vals[i]));
  const cond = { type: "anomaly", sensitivity: "medium", lookback: 6, direction: "up" };

  it("hôm qua (thứ Tư) vọt lên so với các thứ Tư trước → báo", async () => {
    const data = [...base([100, 102, 98, 101, 99, 100]), day("2025-11-12", 300)];
    const r = await run(data, draft({ window: "yesterday" }, cond));
    expect(r.kind === "single" && r.evaluation).toMatchObject({ verdict: "firing", value: 300, n: 6 });
  });
  it("giá trị bình thường → không báo", async () => {
    const data = [...base([100, 102, 98, 101, 99, 100]), day("2025-11-12", 101)];
    const r = await run(data, draft({ window: "yesterday" }, cond));
    expect(r.kind === "single" && r.evaluation.verdict).toBe("ok");
  });
  it("chỉ so với CÙNG THỨ: ngày thường khác không làm lệch mốc", async () => {
    // Các thứ Tư ~100, nhưng các ngày khác trong tuần rất cao: không được lẫn vào lịch sử
    const noise = ["2025-11-06", "2025-11-07", "2025-11-08", "2025-11-09", "2025-11-10", "2025-11-11"].map((d) => day(d, 5000));
    const data = [...base([100, 102, 98, 101, 99, 100]), ...noise, day("2025-11-12", 101)];
    const r = await run(data, draft({ window: "yesterday" }, cond));
    expect(r.kind === "single" && r.evaluation.verdict).toBe("ok");
  });
  it("dữ liệu bắt đầu muộn: kỳ trước ngày bắt đầu không bị coi là 0; còn < 4 kỳ thì 'chưa đủ dữ liệu'", async () => {
    // chỉ có dữ liệu từ 22/10: lịch sử khả dụng = 5/11, 29/10, 22/10 (3 kỳ) → chưa đủ
    const data = [day("2025-11-05", 100), day("2025-10-29", 100), day("2025-10-22", 100), day("2025-11-12", 900)];
    const r = await run(data, draft({ window: "yesterday" }, cond));
    expect(r.kind === "single" && r.evaluation).toMatchObject({ verdict: "insufficient", reason: "not_enough_history", n: 3 });
  });
  it("ngày thật sự không có doanh thu (sau ngày bắt đầu) được tính là 0", async () => {
    // có dữ liệu từ 1/10; thứ Tư 15/10 không có dòng nào → 0 trong lịch sử
    const data = [day("2025-11-05", 100), day("2025-10-29", 100), day("2025-10-22", 100), day("2025-10-08", 100), day("2025-10-01", 100), day("2025-11-12", 100)];
    const r = await run(data, draft({ window: "yesterday" }, { ...cond, direction: "both" }));
    expect(r.kind === "single" && r.evaluation.n).toBe(6);
    expect(r.kind === "single" && r.evaluation.mean).toBeCloseTo(500 / 6, 6);
  });
});

describe("per_group", () => {
  it("threshold theo từng nhóm: liệt kê các nhóm vi phạm, nặng nhất trước", async () => {
    const data = [
      day("2025-11-13", 5, { Tỉnh: "Hà Nội" }), day("2025-11-13", 50, { Tỉnh: "Huế" }),
      day("2025-11-13", 1, { Tỉnh: "Đà Nẵng" }), day("2025-11-13", 20, { Tỉnh: "Cần Thơ" }),
    ];
    const d = draft({ groupBy: "Tỉnh" }, { type: "per_group", inner: { type: "threshold", op: "lt", value: 10 } });
    const r = await run(data, d);
    expect(r.kind).toBe("groups");
    if (r.kind !== "groups") return;
    expect(r.violating.map((v) => [v.group, v.evaluation.value])).toEqual([["Đà Nẵng", 1], ["Hà Nội", 5]]); // xa ngưỡng nhất trước
    expect(r.evaluated).toBe(4);
    expect(verdictOf(r)).toBe("firing");
  });

  it("không nhóm nào vi phạm → ok", async () => {
    const d = draft({ groupBy: "Tỉnh" }, { type: "per_group", inner: { type: "threshold", op: "lt", value: 1 } });
    const r = await run([day("2025-11-13", 5, { Tỉnh: "A" })], d);
    expect(r.kind === "groups" && r.violating).toEqual([]);
    expect(verdictOf(r)).toBe("ok");
  });

  it("change theo nhóm: nhóm biến mất hoàn toàn ở kỳ này (tổng = 0) là giảm 100%", async () => {
    const data = [
      day("2025-11-11", 100, { Tỉnh: "Hà Nội" }), day("2025-11-12", 95, { Tỉnh: "Hà Nội" }),
      day("2025-11-11", 100, { Tỉnh: "Huế" }), // Huế không có dòng hôm qua
    ];
    const d = draft({ window: "yesterday", groupBy: "Tỉnh" }, { type: "per_group", inner: { type: "change", op: "drop_pct", value: 20, vs: "prev_period" } });
    const r = await run(data, d);
    expect(r.kind === "groups" && r.violating.map((v) => [v.group, v.evaluation.changePct])).toEqual([["Huế", -100]]);
  });

  it("anomaly theo nhóm: chỉ nhóm lệch bị liệt kê", async () => {
    const wed = ["2025-11-05", "2025-10-29", "2025-10-22", "2025-10-15"];
    const data: Row[] = [];
    for (const [i, dt] of wed.entries()) {
      data.push(day(dt, 100 + i, { Tỉnh: "Hà Nội" }), day(dt, 200 - i, { Tỉnh: "Huế" }));
    }
    data.push(day("2025-11-12", 101, { Tỉnh: "Hà Nội" }), day("2025-11-12", 900, { Tỉnh: "Huế" }));
    const d = draft({ window: "yesterday", groupBy: "Tỉnh" }, { type: "per_group", inner: { type: "anomaly", sensitivity: "medium", lookback: 4, direction: "both" } });
    const r = await run(data, d);
    expect(r.kind === "groups" && r.violating.map((v) => v.group)).toEqual(["Huế"]);
  });

  it("nhóm chưa đủ lịch sử được đếm là 'chưa đủ dữ liệu', không báo", async () => {
    const data = [day("2025-11-12", 900, { Tỉnh: "Mới" })];
    const d = draft({ window: "yesterday", groupBy: "Tỉnh" }, { type: "per_group", inner: { type: "anomaly", sensitivity: "high", lookback: 4, direction: "both" } });
    const r = await run(data, d);
    expect(r.kind === "groups" && [r.violating.length, r.evaluated, r.insufficient]).toEqual([0, 1, 1]);
    expect(verdictOf(r)).toBe("insufficient");
  });

  it("tên nhóm trống được gọi là (trống)", async () => {
    const d = draft({ groupBy: "Tỉnh" }, { type: "per_group", inner: { type: "threshold", op: "lt", value: 10 } });
    const r = await run([day("2025-11-13", 1, { Tỉnh: null })], d);
    expect(r.kind === "groups" && r.violating.map((v) => v.group)).toEqual(["(trống)"]);
  });
});

describe("truy vấn gửi cho engine", () => {
  it("dùng đúng bộ lọc ngày theo khoảng và cột ngày của luật", async () => {
    const specs: QuerySpec[] = [];
    const d = draft({ window: "last_7d" }, { type: "threshold", op: "lt", value: 1 });
    await computeAlert(d.metric, d.condition as never, deps([], {}, specs));
    expect(specs).toHaveLength(1);
    const s = specs[0];
    expect(s.mode === "aggregate" && s.filters).toEqual([{ column: "Ngày", values: [], dateRange: { from: "2025-11-06", to: "2025-11-12" } }]);
  });
  it("lỗi của engine được ném ra để người gọi chuyển sang trạng thái lỗi", async () => {
    const d = draft({}, { type: "threshold", op: "lt", value: 1 });
    await expect(computeAlert(d.metric, d.condition as never, { ...deps([]), exec: async () => { throw new Error("hỏng"); } })).rejects.toThrow("hỏng");
  });
});

describe("summarize", () => {
  it("luật một giá trị: số hiện tại, kỳ so sánh, và loại bỏ Infinity/NaN để trả JSON an toàn", async () => {
    const data = [day("2025-11-12", 700), day("2025-11-11", 1000)];
    const r = await run(data, draft({ window: "yesterday" }, { type: "change", op: "drop_pct", value: 20, vs: "prev_period" }));
    const s = summarize(r);
    expect(s).toMatchObject({ kind: "single", verdict: "firing", value: 700, prev: 1000, changePct: -30, label: "hôm qua (12/11/2025)", prevLabel: "hôm qua (11/11/2025)" });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
  it("z = Infinity (lịch sử phẳng bằng 0) được đổi thành null", async () => {
    const wed = ["2025-11-05", "2025-10-29", "2025-10-22", "2025-10-15"].map((d) => day(d, 0));
    const r = await run([...wed, day("2025-11-12", 5)], draft({ window: "yesterday" }, { type: "anomaly", sensitivity: "low", lookback: 4, direction: "both" }));
    const s = summarize(r);
    expect(s.verdict).toBe("firing");
    expect(s.z).toBeNull();
  });
  it("luật theo nhóm: tối đa 5 nhóm, kèm tổng số nhóm vi phạm", async () => {
    const data = Array.from({ length: 8 }, (_, i) => day("2025-11-13", i + 1, { Tỉnh: `T${i}` }));
    const r = await run(data, draft({ groupBy: "Tỉnh" }, { type: "per_group", inner: { type: "threshold", op: "lt", value: 100 } }));
    const s = summarize(r);
    expect(s).toMatchObject({ kind: "groups", groupBy: "Tỉnh", violatingCount: 8, evaluated: 8, verdict: "firing" });
    expect(s.groups).toHaveLength(5);
  });
  it("hoãn đánh giá (chưa tới giờ chốt)", async () => {
    const d = draft({ settleHour: 21 }, { type: "threshold", op: "lt", value: 10 });
    const r = await computeAlert(d.metric, d.condition as never, deps([], { now: vn(2025, 11, 13, 9) }));
    expect(summarize(r)).toMatchObject({ kind: "deferred", verdict: "deferred", settleHour: 21 });
  });
});

describe("computeSeries", () => {
  const d = (m: Record<string, unknown>) => draft(m, { type: "threshold", op: "lt", value: 1 }).metric;
  it("cửa sổ theo ngày: 14 ngày liên tiếp, kỳ hiện tại ở cuối, ngày không có dòng = 0", async () => {
    const data = [day("2025-11-13", 30), day("2025-11-12", 20), day("2025-11-10", 10), day("2025-10-01", 1)];
    const r = await computeSeries(d({}), deps(data), 14);
    expect(r!.labels).toHaveLength(14);
    expect(r!.labels[0]).toBe("31/10");
    expect(r!.labels[13]).toBe("13/11");
    expect(r!.values.slice(-4)).toEqual([10, 0, 20, 30]); // 10/11, 11/11 (không có dòng = 0), 12/11, 13/11
  });
  it("kỳ nằm trước ngày bắt đầu của dữ liệu là null, không phải 0", async () => {
    const data = [day("2025-11-11", 5), day("2025-11-13", 7)];
    const r = await computeSeries(d({ window: "today" }), deps(data), 5);
    // 9/11, 10/11 trước ngày bắt đầu (11/11) → null
    expect(r!.values).toEqual([null, null, 5, 0, 7]);
  });
  it("cửa sổ tuần: các tuần trước cùng độ dài; tháng: nhãn MM/yyyy", async () => {
    const w = await computeSeries(d({ window: "last_7d" }), deps([day("2025-11-10", 9), day("2025-11-03", 4)]), 3);
    expect(w!.labels).toEqual(["23/10", "30/10", "06/11"]);
    expect(w!.values.slice(-2)).toEqual([4, 9]);
    const mth = await computeSeries(d({ window: "this_month" }), deps([day("2025-11-05", 1), day("2025-10-05", 2)]), 2);
    expect(mth!.labels).toEqual(["10/2025", "11/2025"]);
    expect(mth!.values).toEqual([2, 1]);
  });
  it("window=all hoặc thiếu cột ngày: không có chuỗi", async () => {
    expect(await computeSeries(d({ window: "all", dateColumn: undefined }), deps([]), 14)).toBeNull();
  });
});
