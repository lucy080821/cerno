import { describe, expect, it } from "vitest";
import type { Row } from "@dashboard/chart-engine";
import { COL } from "@/lib/orders/canonical";
import { ALL_CHANNELS, applyAdSpend, clearAdSpend, splitAmount, summarizeAdSpend } from "./ad-spend";
import { buildOrders } from "./order-profit";

const line = (channel: string, id: string | null, date: string, revenue: number, extra: Row = {}): Row => ({
  [COL.channel]: channel,
  [COL.orderId]: id,
  [COL.date]: date,
  [COL.status]: "Hoàn thành",
  [COL.revenue]: revenue,
  [COL.netRevenue]: revenue,
  [COL.adCost]: null,
  ...extra,
});
const ads = (rows: Row[]) => rows.map((r) => r[COL.adCost] ?? null);

describe("splitAmount", () => {
  it("tổng luôn đúng, phần dư chia cho phần có số lẻ lớn nhất", () => {
    expect(splitAmount(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitAmount(10_000, [100, 300])).toEqual([2500, 7500]);
    const parts = splitAmount(1_234_567, [3, 7, 11, 13, 17]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_234_567);
  });
  it("trọng số bằng 0 thì chia đều", () => {
    expect(splitAmount(9, [0, 0, 0])).toEqual([3, 3, 3]);
  });
  it("không có phần nào", () => {
    expect(splitAmount(5, [])).toEqual([]);
  });
});

describe("applyAdSpend", () => {
  const rows = [
    line("Shopee", "A", "2026-06-01 09:00", 100_000),
    line("Shopee", "B", "2026-06-01 15:30", 300_000),
    line("TikTok Shop", "C", "2026-06-01 10:00", 200_000),
    line("Shopee", "D", "2026-06-02", 50_000),
  ];

  it("chia chi phí của (kênh, ngày) cho đơn của kênh đó theo tỉ lệ doanh thu", () => {
    const r = applyAdSpend(rows, [{ channel: "Shopee", day: "2026-06-01", amount: 40_000 }]);
    expect(ads(r.rows)).toEqual([10_000, 30_000, null, null]);
    expect(r.orders).toBe(2);
    expect(r.allocated).toBe(40_000);
    expect(r.unallocated).toEqual([]);
    expect(ads(rows)).toEqual([null, null, null, null]); // không sửa mảng gốc
  });

  it("kênh * chia cho mọi kênh trong ngày; cộng dồn với chi phí riêng của kênh", () => {
    const r = applyAdSpend(rows, [
      { channel: ALL_CHANNELS, day: "2026-06-01", amount: 60_000 }, // 100k:300k:200k → 10k, 30k, 20k
      { channel: "Shopee", day: "2026-06-01", amount: 4_000 }, // 1k, 3k
    ]);
    expect(ads(r.rows)).toEqual([11_000, 33_000, 20_000, null]);
    expect(r.allocated).toBe(64_000);
  });

  it("chi phí thắng giá trị có sẵn trong file, ngày không có chi phí thì giữ nguyên giá trị file", () => {
    const withFile = [line("Shopee", "A", "2026-06-01", 100_000, { [COL.adCost]: 999 }), line("Shopee", "B", "2026-06-02", 100_000, { [COL.adCost]: 777 })];
    const r = applyAdSpend(withFile, [{ channel: "Shopee", day: "2026-06-01", amount: 5_000 }]);
    expect(ads(r.rows)).toEqual([5_000, 777]);
  });

  it("đơn nhiều dòng: chi phí ghi ở dòng đầu, các dòng sau để trống", () => {
    const multi = [line("Shopee", "A", "2026-06-01", 100_000, { [COL.adCost]: 50 }), line("Shopee", "A", "2026-06-01", 100_000, { [COL.adCost]: 60 }), line("Shopee", "B", "2026-06-01", 200_000)];
    const r = applyAdSpend(multi, [{ channel: "Shopee", day: "2026-06-01", amount: 8_000 }]);
    // đơn A có doanh thu 200k, đơn B 200k → mỗi đơn 4.000
    expect(ads(r.rows)).toEqual([4_000, null, 4_000]);
  });

  it("đơn hủy vẫn nhận phần chi phí (quảng cáo đã tốn tiền) và lãi từng đơn cộng đúng tổng", () => {
    const withCancel = [line("Shopee", "A", "2026-06-01", 100_000), line("Shopee", "B", "2026-06-01", 100_000, { [COL.status]: "Đã hủy", [COL.netRevenue]: 0 })];
    const r = applyAdSpend(withCancel, [{ channel: "Shopee", day: "2026-06-01", amount: 10_000 }]);
    expect(ads(r.rows)).toEqual([5_000, 5_000]);
    const orders = buildOrders(r.rows);
    expect(orders.reduce((n, o) => n + o.adCost, 0)).toBe(10_000);
  });

  it("đơn không có mã đơn thì mỗi dòng là một đơn", () => {
    const noId = [line("Shopee", null, "2026-06-01", 100_000), line("Shopee", null, "2026-06-01", 300_000)];
    expect(ads(applyAdSpend(noId, [{ channel: "Shopee", day: "2026-06-01", amount: 4_000 }]).rows)).toEqual([1_000, 3_000]);
  });

  it("ngày/kênh không có đơn thì báo chưa chia được, không mất tiền âm thầm", () => {
    const e = { channel: "Shopee", day: "2026-07-01", amount: 7_000 };
    const r = applyAdSpend(rows, [e, { channel: "Lazada", day: "2026-06-01", amount: 1_000 }]);
    expect(r.unallocated).toEqual([e, { channel: "Lazada", day: "2026-06-01", amount: 1_000 }]);
    expect(r.changed).toBe(0);
    expect(r.rows).toBe(rows);
  });

  it("idempotent: chạy lại với cùng dữ liệu ra cùng kết quả", () => {
    const entries = [{ channel: "Shopee", day: "2026-06-01", amount: 12_345 }];
    const once = applyAdSpend(rows, entries);
    const twice = applyAdSpend(once.rows, entries);
    expect(ads(twice.rows)).toEqual(ads(once.rows));
    expect(twice.changed).toBe(0);
  });

  it("doanh thu toàn 0 thì chia đều", () => {
    const zero = [line("Shopee", "A", "2026-06-01", 0), line("Shopee", "B", "2026-06-01", 0)];
    expect(ads(applyAdSpend(zero, [{ channel: "Shopee", day: "2026-06-01", amount: 3_001 }]).rows)).toEqual([1_501, 1_500]);
  });

  it("đơn không đọc được ngày bị bỏ qua", () => {
    const bad = [line("Shopee", "A", "không rõ", 100_000)];
    const r = applyAdSpend(bad, [{ channel: "Shopee", day: "2026-06-01", amount: 1_000 }]);
    expect(r.unallocated).toHaveLength(1);
  });

  it("số tiền lẻ được làm tròn đồng", () => {
    expect(ads(applyAdSpend([line("Shopee", "A", "2026-06-01", 1)], [{ channel: "Shopee", day: "2026-06-01", amount: 1234.6 }]).rows)).toEqual([1235]);
  });
});

describe("clearAdSpend / summarizeAdSpend", () => {
  it("xoá chi phí của đơn mà các dòng chi phí phủ tới", () => {
    const rows = [line("Shopee", "A", "2026-06-01", 100, { [COL.adCost]: 5 }), line("TikTok Shop", "B", "2026-06-01", 100, { [COL.adCost]: 9 })];
    const r = clearAdSpend(rows, [{ channel: "Shopee", day: "2026-06-01", amount: 5 }]);
    expect(ads(r.rows)).toEqual([null, 9]);
    expect(r.changed).toBe(1);
  });

  it("tóm tắt theo kênh", () => {
    const s = summarizeAdSpend([
      { channel: "Shopee", day: "2026-06-02", amount: 5 },
      { channel: "Shopee", day: "2026-06-01", amount: 10 },
      { channel: "Facebook", day: "2026-06-03", amount: 100 },
    ]);
    expect(s).toEqual([
      { channel: "Facebook", days: 1, total: 100, from: "2026-06-03", to: "2026-06-03" },
      { channel: "Shopee", days: 2, total: 15, from: "2026-06-01", to: "2026-06-02" },
    ]);
  });
});
