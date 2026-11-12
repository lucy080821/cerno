import { describe, expect, it } from "vitest";
import { Dashboard, ReportSubscriptionInput } from "@dashboard/schema";
import {
  MAX_PROMPT, MAX_WIDGETS, PROMPT_SUGGESTIONS, appendSuggestion, emptyForm, formFromRow, formToInput, hourLabel, reportableWidgets, scheduleLabel,
} from "./format";

describe("scheduleLabel", () => {
  it("hằng ngày, tuần, tháng", () => {
    expect(scheduleLabel({ frequency: "daily", weekday: null, month_day: null, hour_vn: 8 })).toBe("Hằng ngày · 08:00");
    expect(scheduleLabel({ frequency: "weekly", weekday: 1, month_day: null, hour_vn: 17 })).toBe("Hằng tuần · Thứ Hai · 17:00");
    expect(scheduleLabel({ frequency: "weekly", weekday: 7, month_day: null, hour_vn: 0 })).toBe("Hằng tuần · Chủ nhật · 00:00");
    expect(scheduleLabel({ frequency: "monthly", weekday: null, month_day: 31, hour_vn: 9 })).toBe("Hằng tháng · Ngày 31 · 09:00");
  });
  it("giá trị lệch thì kẹp về khoảng hợp lệ, không ném lỗi", () => {
    expect(scheduleLabel({ frequency: "weekly", weekday: 99, month_day: null, hour_vn: 8 })).toContain("Chủ nhật");
    expect(scheduleLabel({ frequency: "weekly", weekday: null, month_day: null, hour_vn: 8 })).toContain("Thứ Hai");
  });
  it("hourLabel", () => expect(hourLabel(5)).toBe("05:00"));
});

describe("biểu mẫu → dữ liệu gửi API", () => {
  it("mọi biểu mẫu mặc định đều qua kiểm của schema", () => {
    for (const frequency of ["daily", "weekly", "monthly"] as const) {
      const input = formToInput({ ...emptyForm("An@X.com"), frequency });
      expect(ReportSubscriptionInput.safeParse(input).success, frequency).toBe(true);
    }
  });
  it("chuẩn hoá email, chỉ gửi thứ/ngày của đúng tần suất, cắt giới hạn", () => {
    const f = { ...emptyForm("  An@X.com "), frequency: "monthly" as const, month_day: 31, weekday: 3, prompt: "x".repeat(2000), widget_ids: Array(9).fill("w") };
    const i = formToInput(f);
    expect(i).toMatchObject({ recipient_email: "an@x.com", month_day: 31, weekday: null });
    expect(i.prompt).toHaveLength(MAX_PROMPT);
    expect(i.widget_ids).toHaveLength(MAX_WIDGETS);
    expect(formToInput({ ...f, frequency: "daily" })).toMatchObject({ weekday: null, month_day: null });
  });
  it("formFromRow rồi formToInput giữ nguyên cấu hình", () => {
    const row = {
      id: "i", recipient_email: "a@x.com", recipient_name: "An", frequency: "weekly" as const, weekday: 5, month_day: null, hour_vn: 18,
      prompt: "Ngắn", widget_ids: ["w1"], include_images: false, link_mode: "login" as const, enabled: false,
    };
    const back = formToInput(formFromRow(row));
    expect(back).toMatchObject({ recipient_email: "a@x.com", weekday: 5, hour_vn: 18, prompt: "Ngắn", widget_ids: ["w1"], include_images: false, link_mode: "login", enabled: false });
    expect(formFromRow(row).id).toBe("i");
  });
});

describe("gợi ý yêu cầu", () => {
  it("có đúng 4 mẫu", () => expect(PROMPT_SUGGESTIONS.map((s) => s.label)).toEqual([
    "Tập trung khu vực…", "So cùng kỳ năm ngoái", "Chỉ ra 3 điểm yếu nhất", "Ngắn gọn dưới 150 chữ",
  ]));
  it("nối thêm vào ô, không chèn trùng, không vượt giới hạn", () => {
    expect(appendSuggestion("", "A.")).toBe("A.");
    expect(appendSuggestion("Xin chào.", "A.")).toBe("Xin chào. A.");
    expect(appendSuggestion("Xin chào. A.", "A.")).toBe("Xin chào. A.");
    const long = "x".repeat(MAX_PROMPT - 2);
    expect(appendSuggestion(long, "ABCDEFG")).toBe(long);
  });
});

describe("reportableWidgets", () => {
  const box = { x: 0, w: 100, h: 100 };
  const sum = { column: "DT", aggregation: "sum" as const };
  const doc = Dashboard.parse({
    schemaVersion: 1, id: "d", name: "D", canvas: { width: 1000, height: 600, background: "#fff" },
    widgets: [
      { id: "b", ...box, y: 200, config: { kind: "chart", chartType: "bar", sourceId: "s", dimensions: [], metrics: [], title: "Cột" } },
      { id: "t", ...box, y: 0, config: { kind: "chart", chartType: "table", sourceId: "s", dimensions: [], metrics: [] } },
      { id: "k", ...box, y: 100, config: { kind: "kpi", sourceId: "s", metric: sum } },
      { id: "h", ...box, y: 50, hidden: true, config: { kind: "kpi", sourceId: "s", metric: sum, title: "Ẩn" } },
      { id: "x", ...box, y: 10, config: { kind: "text", text: "x", fontSize: 12, bold: false, align: "left" } },
    ],
  });
  it("chỉ biểu đồ (không bảng) và KPI hiển thị, theo thứ tự đọc, có nhãn mặc định", () => {
    expect(reportableWidgets(doc)).toEqual([
      { id: "k", kind: "kpi", label: "KPI DT" },
      { id: "b", kind: "chart", label: "Cột" },
    ]);
  });
});
