import { describe, expect, it } from "vitest";
import type { FactNumber, ReportFacts } from "./facts";
import { allowedMagnitudes, extractNumbers, verifyNumbers } from "./verify-numbers";

const n = (value: number, text: string, short: string): FactNumber => ({ value, text, short });

const facts: ReportFacts = {
  period: { from: "2025-10-01", to: "2025-10-31", label: "Tháng 10/2025" },
  prevPeriod: { from: "2025-09-01", to: "2025-09-30", label: "Tháng 09/2025" },
  updatedAt: "2025-11-03T00:00:00Z",
  kpis: [
    {
      title: "Doanh thu", value: n(125_430_000, "125.430.000", "125,4 triệu"), prev: n(100_000_000, "100.000.000", "100 triệu"),
      diff: n(25_430_000, "25.430.000", "25,4 triệu"), widgetId: "w", growthPct: 25.4, growthText: "+25,4%", dir: "up", tone: "good", kind: "number",
    },
    {
      title: "Số đơn hàng", value: n(1234, "1.234", "1.234"), prev: n(1500, "1.500", "1.500"),
      diff: n(-266, "-266", "-266"), widgetId: "w", growthPct: -17.7, growthText: "−17,7%", dir: "down", tone: "bad", kind: "number",
    },
    {
      title: "Biên lợi nhuận", value: n(12.5, "12,5", "12,5"), prev: null, diff: null, widgetId: "w", growthPct: null, growthText: "", dir: null, tone: "neutral", kind: "number",
    },
  ],
  movers: [{
    chart: "Doanh thu theo tỉnh", dimension: "Tỉnh", metric: "Doanh thu",
    up: [{ name: "Hà Nội", value: n(60_000_000, "60.000.000", "60 triệu"), delta: n(20_000_000, "20.000.000", "20 triệu") }],
    down: [{ name: "Chi nhánh 12", value: n(3_300_000_000, "3.300.000.000", "3,3 tỷ"), delta: n(-450_000, "-450.000", "-450 nghìn") }],
  }],
  notes: [],
};

const ok = (t: string) => verifyNumbers([t], facts);
const bad = (t: string) => verifyNumbers([t], facts).unverified;

describe("extractNumbers: đọc định dạng Việt Nam", () => {
  const val = (t: string) => extractNumbers(t)[0].candidates.map((c) => c.value);
  it("hàng nghìn bằng dấu chấm, thập phân bằng dấu phẩy", () => {
    expect(val("1.234.567 đồng")).toEqual([1_234_567]);
    expect(val("1.234,5")).toEqual([1234.5]);
    expect(val("125,4 triệu")).toEqual([125_400_000]);
  });
  it("kiểu Anh 1,234.5 và 1,234,567", () => {
    expect(val("1,234.5")).toEqual([1234.5]);
    expect(val("1,234,567")).toEqual([1_234_567]);
  });
  it("mơ hồ 1.234 / 1,234: trả cả hai cách đọc", () => {
    expect(val("1.234")).toEqual([1234, 1.234]);
    expect(val("1,234")).toEqual([1.234, 1234]);
  });
  it("đơn vị nghìn/triệu/tỷ, viết tắt k/M/B dính liền số", () => {
    expect(val("45 nghìn")).toEqual([45_000]);
    expect(val("2,3 tỷ")).toEqual([2_300_000_000]);
    expect(val("1,2K")).toEqual([1200]);
    expect(val("3,4M")).toEqual([3_400_000]);
    expect(val("5 tr")).toEqual([5_000_000]);
  });
  it("k/m/b cách một dấu cách không phải đơn vị (tránh nhầm với từ)", () => {
    expect(val("12 m2")).toEqual([12]);
    expect(extractNumbers("45 k")[0].candidates[0].value).toBe(45);
  });
  it("phần trăm và pp giữ nguyên độ lớn", () => {
    expect(val("55,6%")).toEqual([55.6]);
    expect(val("0,5 pp")).toEqual([0.5]);
  });
  it("số đứng cuối câu: dấu chấm/phẩy cuối không dính vào số", () => {
    expect(val("tổng là 700.")).toEqual([700]);
    expect(val("gồm 1.234, và")).toEqual([1234, 1.234]);
  });
});

describe("verifyNumbers: số đúng", () => {
  it("chép nguyên văn dạng đầy đủ và dạng gọn", () => {
    expect(ok("Doanh thu đạt 125.430.000 đồng.").ok).toBe(true);
    expect(ok("Doanh thu đạt 125,4 triệu, tăng 25,4% so với kỳ trước.").ok).toBe(true);
    expect(ok("Chênh lệch 25,4 triệu so với 100 triệu của tháng trước.").ok).toBe(true);
  });
  it("làm tròn đúng theo số chữ số đã viết", () => {
    expect(ok("khoảng 125 triệu").ok).toBe(true); // 125,43 → 125
    expect(ok("khoảng 25%").ok).toBe(true); // 25,4 → 25
    expect(ok("gần 1,2 nghìn đơn").ok).toBe(true); // 1234 → 1,2 nghìn
  });
  it("số âm/giảm viết bằng giá trị tuyệt đối", () => {
    expect(ok("Số đơn giảm 17,7%, còn 1.234 đơn (giảm 266).").ok).toBe(true);
    expect(ok("giảm 450 nghìn").ok).toBe(true);
  });
  it("số trong nhãn và tên nhóm của facts được chấp nhận", () => {
    expect(ok("Chi nhánh 12 giảm mạnh nhất, còn 3,3 tỷ.").ok).toBe(true);
    expect(ok("Biên lợi nhuận 12,5%.").ok).toBe(true);
  });
  it("định dạng kiểu Anh của cùng số", () => {
    expect(ok("Revenue 125,430,000").ok).toBe(true);
    expect(ok("1,234 đơn").ok).toBe(true);
  });
});

describe("verifyNumbers: số sai bị bắt", () => {
  it("sửa tay một con số", () => {
    const r = ok("Doanh thu đạt 135,4 triệu.");
    expect(r.ok).toBe(false);
    expect(r.unverified).toEqual(["135,4 triệu"]);
  });
  it("phần trăm sai, số đơn sai, tỷ lệ tự tính", () => {
    expect(bad("tăng 30%")).toEqual(["30%"]);
    expect(bad("có 1.500 đơn thành công")).toEqual([]); // 1.500 là kỳ trước → có trong facts
    expect(bad("có 1.700 đơn")).toEqual(["1.700"]);
    expect(bad("tăng gấp 1,6 lần")).toEqual(["1,6"]);
  });
  it("sai đơn vị: 125,4 nghìn thay vì triệu", () => {
    expect(bad("Doanh thu 125,4 nghìn")).toEqual(["125,4 nghìn"]);
  });
  it("không khoan nhượng quá mức: làm tròn lệch quá nửa đơn vị bị bắt", () => {
    expect(bad("tăng 24%")).toEqual(["24%"]); // 25,4 → 25, không phải 24
    expect(bad("khoảng 126 triệu")).toEqual(["126 triệu"]);
  });
  it("liệt kê mỗi số sai một lần dù lặp lại, và gộp qua nhiều đoạn", () => {
    const r = verifyNumbers(["Tăng 99%.", "Giảm 99%.", "Còn 77 triệu."], facts);
    expect(r.unverified).toEqual(["99%", "77 triệu"]);
  });
});

describe("verifyNumbers: số không mang ý nghĩa số liệu thì bỏ qua", () => {
  it("số nguyên nhỏ ≤ 10 không đơn vị", () => {
    expect(ok("Có 3 điểm cần lưu ý, trong 2–3 câu, top 5 tỉnh.").ok).toBe(true);
    expect(ok("10 điểm").ok).toBe(true);
  });
  it("nhưng số nhỏ có % hoặc đơn vị vẫn bị kiểm", () => {
    expect(bad("tăng 5%")).toEqual(["5%"]);
    expect(bad("khoảng 3 triệu")).toEqual(["3 triệu"]);
    expect(bad("có 11 đơn")).toEqual(["11"]);
  });
  it("ngày tháng, quý, tuần, năm, giờ", () => {
    expect(ok("Trong tháng 10/2025 và quý 4 năm 2025, ngày 12/11 lúc 14:30 hoặc 9h.").ok).toBe(true);
    expect(ok("Từ ngày 06/10 đến 12/10/2025, tuần 41.").ok).toBe(true);
    expect(ok("Kỳ 2025-10-01 đến 2025-10-31.").ok).toBe(true);
  });
  it("độ dài khoảng thời gian", () => {
    expect(ok("so với 30 ngày trước, 4 tuần gần nhất, 6 tháng qua").ok).toBe(true);
  });
  it("số thứ tự đầu dòng", () => {
    expect(ok("1. Doanh thu tăng\n2. Số đơn giảm\n12) Ghi chú").ok).toBe(true);
  });
  it("mã dính liền chữ như SP12, Q3", () => {
    expect(ok("Sản phẩm SP9999 và Q3999 bán tốt.").ok).toBe(true);
  });
  it("năm nằm trơ trọi không có 'năm' phía trước vẫn bị kiểm nếu không có trong facts", () => {
    expect(bad("đạt 2030 đơn")).toEqual(["2030"]);
  });
});

describe("allowedMagnitudes", () => {
  it("gồm trường số và số đọc từ chuỗi hiển thị", () => {
    const a = allowedMagnitudes(facts);
    for (const v of [125_430_000, 125.4e6, 25.4, 17.7, 266, 1234, 3.3e9, 450_000, 450e3, 12]) {
      expect(a.some((x) => Math.abs(x - v) < 1e-6), String(v)).toBe(true);
    }
    // Ngày tháng của kỳ báo cáo không phải số liệu: "30" của ngày 30/09 không được làm lọt "30%".
    expect(a).not.toContain(30);
  });
});
