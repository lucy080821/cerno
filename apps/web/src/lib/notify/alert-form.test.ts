import { describe, expect, it } from "vitest";
import {
  columnChoices, earlyAlarmRisk, emptyAlertForm, formFromRule, formToDraft, formToRuleInput, parseNumberInput, previewParts, splitEmails, stateKey,
  type AlertForm, type AlertSchema,
} from "./alert-form";

const schema: AlertSchema = {
  sources: [{ id: "s1", name: "Bán hàng", columns: [{ name: "Ngày", type: "date" }, { name: "DT", type: "number" }, { name: "Tỉnh", type: "string" }, { name: "Mã đơn", type: "string" }] }],
  calc: [{ name: "Biên", sourceId: "s1" }, { name: "Lạ", sourceId: "s2" }],
};
const ME = "chu@example.com";
const OWNER = { isOwner: true, me: ME };

const base = (over: Partial<AlertForm> = {}): AlertForm => ({ ...emptyAlertForm(schema, ME), name: "Doanh thu thấp", value: "10000000", ...over });

describe("parseNumberInput", () => {
  it("số kiểu Việt Nam và Anh", () => {
    expect(parseNumberInput("10000000")).toBe(10_000_000);
    expect(parseNumberInput("10.000.000")).toBe(10_000_000);
    expect(parseNumberInput("12,5")).toBe(12.5);
    expect(parseNumberInput("1,234.5")).toBe(1234.5);
    expect(parseNumberInput("1.234,5")).toBe(1234.5);
    expect(parseNumberInput("-7")).toBe(-7);
    expect(parseNumberInput("  20 ")).toBe(20);
  });
  it("không phải số thì null", () => {
    for (const x of ["", "  ", "abc", "10 triệu", "1..2", "--1"]) expect(parseNumberInput(x), x).toBeNull();
  });
});

describe("splitEmails", () => {
  it("tách theo dấu phẩy/chấm phẩy/khoảng trắng/xuống dòng, chữ thường, bỏ trùng", () => {
    expect(splitEmails("A@x.com, b@x.com;c@x.com\n a@X.com  ")).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(splitEmails("  ")).toEqual([]);
  });
});

describe("columnChoices / emptyAlertForm", () => {
  it("cột theo loại; trường tính toán chỉ của đúng nguồn", () => {
    const c = columnChoices(schema, "s1");
    expect(c.numeric).toEqual(["DT"]);
    expect(c.date).toEqual(["Ngày"]);
    expect(c.metric).toEqual(["Ngày", "DT", "Tỉnh", "Mã đơn", "Biên"]);
    expect(c.calc).toEqual(["Biên"]);
  });
  it("biểu mẫu trống: cột số đầu tiên, cột ngày đầu tiên, khoảng hôm nay, người nhận là chính mình", () => {
    const f = emptyAlertForm(schema, ME);
    expect(f).toMatchObject({ sourceId: "s1", column: "DT", dateColumn: "Ngày", window: "today", kind: "threshold", recipients: ME, perGroup: false, settleHour: null });
  });
  it("điền sẵn từ widget KPI", () => {
    const f = emptyAlertForm(schema, ME, { sourceId: "s1", column: "Mã đơn", aggregation: "count_distinct", widgetId: "w1", name: "Số đơn" });
    expect(f).toMatchObject({ column: "Mã đơn", aggregation: "count_distinct", widget_id: "w1", name: "Số đơn" });
  });
  it("nguồn không có cột ngày: khoảng 'toàn bộ dữ liệu'", () => {
    const s: AlertSchema = { sources: [{ id: "x", name: "X", columns: [{ name: "A", type: "number" }] }], calc: [] };
    expect(emptyAlertForm(s, ME).window).toBe("all");
  });
});

describe("formToRuleInput", () => {
  it("'doanh thu hôm nay dưới 10 triệu' → luật ngưỡng hợp lệ", () => {
    const r = formToRuleInput(base(), OWNER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.metric).toMatchObject({ sourceId: "s1", metric: { column: "DT", aggregation: "sum" }, dateColumn: "Ngày", window: "today" });
    expect(r.input.condition).toEqual({ type: "threshold", op: "lt", value: 10_000_000 });
    expect(r.input.recipients).toEqual([ME]);
    expect(r.input.cooldown_minutes).toBe(360);
  });
  it("thay đổi %, bất thường, không có dữ liệu mới, theo từng nhóm", () => {
    expect((formToRuleInput(base({ kind: "change", window: "yesterday", changeOp: "drop_pct", changeValue: "20", vs: "prev_year" }), OWNER) as { input: { condition: unknown } }).input.condition)
      .toEqual({ type: "change", op: "drop_pct", value: 20, vs: "prev_year" });
    expect((formToRuleInput(base({ kind: "anomaly", window: "yesterday", direction: "up", lookback: 6, sensitivity: "high" }), OWNER) as { input: { condition: unknown } }).input.condition)
      .toEqual({ type: "anomaly", sensitivity: "high", lookback: 6, direction: "up" });
    const st = formToRuleInput(base({ kind: "stale", staleHours: "12" }), OWNER);
    expect(st.ok && st.input.condition).toEqual({ type: "stale", hours: 12 });
    expect(st.ok && st.input.metric).toMatchObject({ window: "all", filters: [] });
    const pg = formToRuleInput(base({ perGroup: true, groupBy: "Tỉnh" }), OWNER);
    expect(pg.ok && pg.input.condition).toEqual({ type: "per_group", inner: { type: "threshold", op: "lt", value: 10_000_000 } });
    expect(pg.ok && pg.input.metric.groupBy).toBe("Tỉnh");
  });
  it("window=all: không gửi cột ngày; chỉ gửi settleHour khi có khoảng thời gian", () => {
    const all = formToRuleInput(base({ window: "all", settleHour: 21 }), OWNER);
    expect(all.ok && all.input.metric.dateColumn).toBeUndefined();
    expect(all.ok && all.input.metric.settleHour).toBeUndefined();
    const ok = formToRuleInput(base({ settleHour: 21 }), OWNER);
    expect(ok.ok && ok.input.metric.settleHour).toBe(21);
  });
  it("người không phải chủ luôn gửi tới email của CHÍNH mình, dù biểu mẫu ghi gì", () => {
    const r = formToRuleInput(base({ recipients: "nguoi-khac@x.com" }), { isOwner: false, me: "khach@x.com" });
    expect(r.ok && r.input.recipients).toEqual(["khach@x.com"]);
  });
  it("chủ nhập nhiều người nhận", () => {
    const r = formToRuleInput(base({ recipients: "a@x.com, b@x.com" }), OWNER);
    expect(r.ok && r.input.recipients).toEqual(["a@x.com", "b@x.com"]);
  });
  it("báo lỗi rõ ràng: thiếu tên, ngưỡng không phải số, % ≤ 0, giờ không nguyên, thiếu cột nhóm, email sai, quá 20 người", () => {
    const err = (f: AlertForm) => { const r = formToRuleInput(f, OWNER); return r.ok ? null : r.error; };
    expect(err(base({ name: "  " }))).toMatch(/tên/);
    expect(err(base({ value: "mười triệu" }))).toMatch(/ngưỡng/);
    expect(err(base({ kind: "change", window: "yesterday", changeValue: "0" }))).toMatch(/phần trăm/);
    expect(err(base({ kind: "stale", staleHours: "1,5" }))).toMatch(/số giờ/);
    expect(err(base({ perGroup: true, groupBy: "" }))).toMatch(/nhóm/);
    expect(err(base({ recipients: "khong-phai-email" }))).toMatch(/email/);
    expect(err(base({ recipients: "" }))).toMatch(/ít nhất một email/);
    expect(err(base({ recipients: Array.from({ length: 21 }, (_, i) => `a${i}@x.com`).join(",") }))).toMatch(/Tối đa 20/);
    expect(err(base({ sourceId: "" }))).toMatch(/nguồn/);
    expect(err(base({ column: "" }))).toMatch(/cột/);
  });
  it("lỗi kiểm chéo của schema được trả về: change với khoảng 'toàn bộ'", () => {
    const r = formToRuleInput(base({ kind: "change", window: "all" }), OWNER);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/khoảng thời gian/);
  });
});

describe("formToDraft", () => {
  it("không đòi người nhận", () => {
    const r = formToDraft(base({ recipients: "" }));
    expect(r.ok).toBe(true);
  });
  it("lỗi biểu mẫu thì trả lỗi", () => {
    expect(formToDraft(base({ value: "x" })).ok).toBe(false);
  });
});

describe("formFromRule: luật → biểu mẫu → luật giữ nguyên", () => {
  const cases: [string, AlertForm][] = [
    ["ngưỡng", base({ op: "gte", value: "5,5", window: "this_month", settleHour: 20 })],
    ["thay đổi", base({ kind: "change", window: "last_7d", changeOp: "rise_pct", changeValue: "15", vs: "prev_year" })],
    ["bất thường", base({ kind: "anomaly", window: "yesterday", sensitivity: "low", lookback: 12, direction: "down" })],
    ["stale", base({ kind: "stale", staleHours: "48" })],
    ["theo nhóm", base({ perGroup: true, groupBy: "Tỉnh", kind: "change", window: "yesterday" })],
  ];
  for (const [name, f] of cases) {
    it(name, () => {
      const r = formToRuleInput(f, OWNER);
      expect(r.ok, name).toBe(true);
      if (!r.ok) return;
      const back = formFromRule({ ...r.input, id: "r1" }, schema, ME);
      const again = formToRuleInput(back, OWNER);
      expect(again.ok && again.input).toEqual(r.input);
      expect(back.id).toBe("r1");
    });
  }
  it("luật hỏng/không đọc được: vẫn trả biểu mẫu (tên giữ lại) thay vì ném lỗi", () => {
    const f = formFromRule({ id: "x", name: "Hỏng", metric: { sai: 1 }, condition: { type: "la" } }, schema, ME);
    expect(f).toMatchObject({ id: "x", name: "Hỏng", kind: "threshold" });
  });
});

describe("earlyAlarmRisk", () => {
  it("khoảng chưa kết thúc + điều kiện dễ báo sớm", () => {
    expect(earlyAlarmRisk(base({ window: "today", op: "lt" }))).toBe(true);
    expect(earlyAlarmRisk(base({ window: "this_week", op: "lte" }))).toBe(true);
    expect(earlyAlarmRisk(base({ window: "today", op: "gt" }))).toBe(false); // vượt ngưỡng chỉ tăng dần: không báo sớm
    expect(earlyAlarmRisk(base({ window: "yesterday", op: "lt" }))).toBe(false);
    expect(earlyAlarmRisk(base({ kind: "change", window: "this_month", changeOp: "drop_pct" }))).toBe(true);
    expect(earlyAlarmRisk(base({ kind: "change", window: "this_month", changeOp: "rise_pct" }))).toBe(false);
    expect(earlyAlarmRisk(base({ kind: "anomaly", window: "today", direction: "up" }))).toBe(false);
    expect(earlyAlarmRisk(base({ kind: "anomaly", window: "today", direction: "both" }))).toBe(true);
    expect(earlyAlarmRisk(base({ kind: "stale", window: "today" }))).toBe(false);
  });
});

describe("stateKey", () => {
  const now = new Date("2025-11-13T10:00:00Z");
  const r = (o: Partial<Parameters<typeof stateKey>[0]> = {}) => ({ enabled: true, snooze_until: null, last_state: "ok" as const, ...o });
  it("đã tắt > tạm hoãn > trạng thái", () => {
    expect(stateKey(r({ enabled: false, last_state: "firing" }), now)).toBe("disabled");
    expect(stateKey(r({ snooze_until: "2025-11-14T00:00:00Z", last_state: "firing" }), now)).toBe("snoozed");
    expect(stateKey(r({ snooze_until: "2025-11-12T00:00:00Z", last_state: "firing" }), now)).toBe("firing");
    for (const s of ["ok", "firing", "error", "insufficient"] as const) expect(stateKey(r({ last_state: s }), now)).toBe(s);
  });
});

describe("previewParts", () => {
  it("một giá trị: giá trị đã định dạng + khoảng đo + kết luận", () => {
    expect(previewParts({ kind: "single", verdict: "firing", label: "hôm nay (13/11/2025)", value: 7_000_000 })).toEqual({
      kind: "single", verdict: "firing", valueText: "7.000.000", label: "hôm nay (13/11/2025)", reason: undefined,
    });
    expect(previewParts({ kind: "single", verdict: "insufficient", label: "x", value: null, reason: "no_data" })).toMatchObject({ valueText: null, reason: "no_data" });
  });
  it("theo nhóm: số nhóm vi phạm và vài nhóm đầu", () => {
    const p = previewParts({ kind: "groups", verdict: "firing", label: "x", violatingCount: 2, evaluated: 9, groups: [{ group: "Hà Nội", value: 5 }] });
    expect(p).toMatchObject({ kind: "groups", valueText: "2/9", groups: [{ group: "Hà Nội", valueText: "5" }] });
  });
  it("chưa tới giờ chốt", () => {
    expect(previewParts({ kind: "deferred", verdict: "deferred", label: "x", settleHour: 21 })).toMatchObject({ kind: "deferred", settleHour: 21 });
  });
});
