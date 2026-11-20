import { describe, expect, it } from "vitest";
import type { Row } from "@dashboard/chart-engine";
import { buildSuggestions, type SuggestInput } from "./ai-suggest";

const rows: Row[] = [];
const kenh = ["Shopee", "Shopee", "Shopee", "TikTok Shop", "TikTok Shop", "Facebook"];
for (let i = 0; i < 60; i++) rows.push({ "Mã đơn": `D${i}`, "Kênh": kenh[i % kenh.length], "Ngày đặt": `2026-${i < 30 ? "10" : "11"}-${String((i % 28) + 1).padStart(2, "0")}`, "Doanh thu": 100_000 + i, "Số lượng": 1 });
const columns = [
  { name: "Mã đơn", type: "string" }, { name: "Kênh", type: "string" }, { name: "Ngày đặt", type: "date" },
  { name: "Doanh thu", type: "number" }, { name: "Số lượng", type: "number" },
];
const base: SuggestInput = { columns, rows, widgets: [], filterColumns: [], selected: null, canEdit: true };

describe("gợi ý chat AI theo dữ liệu", () => {
  it("dùng tên cột và giá trị thật, bỏ cột mã đơn", () => {
    const s = buildSuggestions(base);
    expect(s).toHaveLength(4);
    expect(s[0]).toBe("Doanh thu nhiều nhất ở Kênh nào?");
    expect(s.join("|")).not.toMatch(/Mã đơn/);
    expect(s.join("|")).not.toMatch(/khu vực|quý 2/i); // các câu cố định cũ không còn
  });

  it("so sánh hai giá trị phổ biến nhất của cột chiều", () => {
    expect(buildSuggestions({ ...base, canEdit: false })).toContain("So sánh Shopee và TikTok Shop về Doanh thu.");
  });

  it("chỉ xem được thì toàn câu hỏi phân tích, không có câu sửa dashboard", () => {
    const s = buildSuggestions({ ...base, canEdit: false });
    expect(s.some((q) => /^Thêm |^Chỉ xem|^Tắt /.test(q))).toBe(false);
  });

  it("được sửa thì có đề nghị thêm biểu đồ/bộ lọc theo cột thật; không đề nghị cái đã có", () => {
    const s = buildSuggestions(base);
    expect(s.some((q) => q.startsWith("Thêm biểu đồ tròn Doanh thu theo Kênh"))).toBe(true);
    const withChart = buildSuggestions({
      ...base,
      widgets: [{ kind: "chart", chartType: "bar", dimensions: ["Kênh"], metrics: ["Doanh thu"] }],
      filterColumns: ["Kênh"],
    });
    expect(withChart.some((q) => /^Thêm biểu đồ (tròn|cột) Doanh thu theo Kênh/.test(q))).toBe(false);
    expect(withChart.some((q) => q === "Thêm bộ lọc theo Kênh.")).toBe(false);
  });

  it("gợi ý lọc theo tháng mới nhất có trong dữ liệu", () => {
    const edit = buildSuggestions({ ...base, widgets: [{ kind: "chart", chartType: "bar", dimensions: ["Kênh"], metrics: ["Doanh thu"] }, { kind: "chart", chartType: "line", dimensions: ["Ngày đặt"], metrics: ["Doanh thu"] }] }, 8);
    expect(edit).toContain("Chỉ xem dữ liệu tháng 11/2026.");
  });

  it("có widget đang chọn thì ưu tiên phân tích widget đó (và dự báo nếu có)", () => {
    const s = buildSuggestions({ ...base, selected: { label: "Doanh thu theo ngày", hasForecast: true } });
    expect(s[0]).toMatch(/^Giải thích dự báo của "Doanh thu theo ngày"/);
    expect(s[1]).toMatch(/^Phân tích "Doanh thu theo ngày"/);
  });

  it("dữ liệu chưa tải vẫn gợi ý theo tên cột; không có cột số thì dùng câu chung", () => {
    const s = buildSuggestions({ ...base, rows: [] });
    expect(s[0]).toBe("Doanh thu nhiều nhất ở Kênh nào?");
    const none = buildSuggestions({ ...base, columns: [{ name: "Ghi chú", type: "string" }], rows: [], canEdit: false });
    expect(none).toEqual(["Tóm tắt nhanh dashboard này.", "Dữ liệu này có điểm gì đáng chú ý?"]);
  });

  it("cột chữ gần như mỗi dòng một giá trị (tên, mã) không được dùng làm chiều", () => {
    const r2: Row[] = Array.from({ length: 50 }, (_, i) => ({ "Tên shop": `Shop ${i}`, "Doanh thu": i }));
    const s = buildSuggestions({ ...base, columns: [{ name: "Tên shop", type: "string" }, { name: "Doanh thu", type: "number" }], rows: r2, canEdit: false });
    expect(s.join("|")).not.toMatch(/Tên shop/);
  });
});
