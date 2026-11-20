import { describe, expect, it } from "vitest";
import { adChannelOf, detectAdSheet, parseAdRows, prepareAdSpend, proposeAdMapping } from "./ad-file";

const csv = (lines: string[]) => new TextEncoder().encode(lines.join("\n"));

describe("nhận diện cột", () => {
  it("báo cáo kiểu Facebook Ads: không nhầm 'chi phí trên mỗi kết quả' là chi phí", () => {
    const m = proposeAdMapping(["Campaign name", "Day", "Cost per result", "Amount spent (VND)", "Impressions"]);
    expect(m).toEqual({ date: 1, spend: 3 });
  });

  it("báo cáo tiếng Việt kiểu Shopee Ads", () => {
    const m = proposeAdMapping(["Tên quảng cáo", "Ngày", "Lượt xem", "Chi phí", "Doanh số", "ROAS"]);
    expect(m).toEqual({ date: 1, spend: 3 });
  });

  it("nhận cột kênh khi có", () => {
    expect(proposeAdMapping(["Ngày", "Nền tảng", "Chi phí"])).toEqual({ date: 0, spend: 2, channel: 1 });
  });

  it("tìm dòng tiêu đề dù có vài dòng ghi chú ở trên", () => {
    const d = detectAdSheet([["Báo cáo quảng cáo tháng 6"], [], ["Ngày", "Chi phí"], ["01/06/2026", "100000"]]);
    expect(d?.headerRow).toBe(2);
    expect(d?.mapping).toEqual({ date: 0, spend: 1 });
  });

  it("không có cột chi phí thì không nhận", () => {
    expect(detectAdSheet([["Ngày", "Lượt xem"], ["01/06/2026", "5"]])).toBeNull();
  });
});

describe("adChannelOf", () => {
  it("chuẩn hoá tên kênh", () => {
    expect(adChannelOf("Shopee Ads")).toBe("Shopee");
    expect(adChannelOf("TikTok")).toBe("TikTok Shop");
    expect(adChannelOf("Meta")).toBe("Facebook");
    expect(adChannelOf("Zalo")).toBeNull();
    expect(adChannelOf("")).toBeNull();
  });
});

describe("parseAdRows", () => {
  const header = ["Chiến dịch", "Ngày", "Chi phí"];
  it("cộng các chiến dịch cùng ngày, bỏ dòng tổng và dòng không có tiền", () => {
    const r = parseAdRows(
      [header, ["A", "01/06/2026", "100.000"], ["B", "01/06/2026", "50.000đ"], ["A", "02/06/2026", "70.000"], ["Tổng", "", "220.000"], ["C", "03/06/2026", ""]],
      0,
      { date: 1, spend: 2 },
      "Facebook",
    );
    expect(r.entries).toEqual([
      { channel: "Facebook", day: "2026-06-01", amount: 150_000 },
      { channel: "Facebook", day: "2026-06-02", amount: 70_000 },
    ]);
    expect(r.warnings.join(" ")).toMatch(/không có ngày hợp lệ/);
    expect(r.warnings.join(" ")).toMatch(/không có số tiền/);
  });

  it("dùng cột kênh khi có, kênh lạ vào 'Khác'", () => {
    const r = parseAdRows([["Ngày", "Kênh", "Chi phí"], ["2026-06-01", "Shopee", "10"], ["2026-06-01", "TikTok", "20"], ["2026-06-01", "Zalo", "5"]], 0, { date: 0, channel: 1, spend: 2 }, null);
    expect(r.entries.map((e) => [e.channel, e.amount])).toEqual([["Khác", 5], ["Shopee", 10], ["TikTok Shop", 20]]);
    expect(r.warnings.join(" ")).toMatch(/Khác/);
  });

  it("bỏ số tiền âm", () => {
    const r = parseAdRows([["Ngày", "Chi phí"], ["2026-06-01", "-5"], ["2026-06-02", "7"]], 0, { date: 0, spend: 1 }, "Shopee");
    expect(r.entries).toEqual([{ channel: "Shopee", day: "2026-06-02", amount: 7 }]);
  });
});

describe("prepareAdSpend", () => {
  it("file CSV đủ cột: ra tóm tắt, cần chọn kênh", async () => {
    const data = csv(["Ngày,Chi phí", "01/06/2026,100000", "02/06/2026,50000"]);
    const noChannel = await prepareAdSpend(data, "ads.csv");
    expect(noChannel.problems).toEqual(["Chưa chọn kênh nhận chi phí quảng cáo."]);
    expect(noChannel.entries).toEqual([]);

    const p = await prepareAdSpend(data, "ads.csv", { channel: "Shopee" });
    expect(p.problems).toEqual([]);
    expect(p.summary).toMatchObject({ days: 2, total: 150_000, dateMin: "2026-06-01", dateMax: "2026-06-02" });
    expect(p.entries).toHaveLength(2);
  });

  it("kênh không hợp lệ từ client bị bỏ qua; ánh xạ ngoài phạm vi bị bỏ", async () => {
    const data = csv(["Ngày,Chi phí", "01/06/2026,100"]);
    const p = await prepareAdSpend(data, "a.csv", { channel: "<script>", mapping: { date: 99, spend: 1 } });
    expect(p.channel).toBeNull();
    expect(p.mapping).toEqual({ spend: 1 });
    expect(p.problems.join(" ")).toMatch(/Chưa chọn cột ngày/);
  });

  it("toàn bộ chi phí bằng 0 thì không nhập", async () => {
    const p = await prepareAdSpend(csv(["Ngày,Chi phí", "01/06/2026,0"]), "a.csv", { channel: "Shopee" });
    expect(p.problems[0]).toMatch(/bằng 0/);
  });

  it("file không có cột chi phí thì báo lỗi dễ hiểu", async () => {
    await expect(prepareAdSpend(csv(["Ngày,Lượt xem", "01/06/2026,5"]), "a.csv", { channel: "Shopee" })).rejects.toThrow(/cột ngày và cột chi phí/);
  });
});
