import { describe, expect, it } from "vitest";
import { effectiveFixedRate, estimateOrderFee } from "./estimate";

const normal = { sellerType: "non_mall", newSeller: false } as const;

describe("ước tính phí sàn Shopee", () => {
  it("phí cố định + xử lý giao dịch 6% + hạ tầng 3.000đ", () => {
    const e = estimateOrderFee({ date: "2026-10-01", lines: [{ gross: 200_000, ratePct: 16 }], buyerShipping: 20_000, settings: normal })!;
    expect(e.fixed).toBe(32_000);
    expect(e.processing).toBe(13_200); // 6% × (200.000 + 20.000)
    expect(e.infra).toBe(3_000);
    expect(e.total).toBe(48_200);
  });

  it("đơn nhiều dòng: mỗi dòng theo mức phí ngành của nó", () => {
    const e = estimateOrderFee({ date: "2026-10-01", lines: [{ gross: 100_000, ratePct: 2 }, { gross: 100_000, ratePct: 17 }], buyerShipping: 0, settings: normal })!;
    expect(e.fixed).toBe(2_000 + 17_000);
  });

  it("còn dòng chưa chọn ngành thì không đoán", () => {
    expect(estimateOrderFee({ date: "2026-10-01", lines: [{ gross: 1, ratePct: 10 }, { gross: 100, ratePct: null }], buyerShipping: 0, settings: normal })).toBeNull();
    expect(estimateOrderFee({ date: "2026-10-01", lines: [], buyerShipping: 0, settings: normal })).toBeNull();
    expect(estimateOrderFee({ date: "2026-10-01", lines: [{ gross: 0, ratePct: 10 }], buyerShipping: 0, settings: normal })).toBeNull();
  });

  it("phí hạ tầng chỉ có với đơn từ 01/07/2025", () => {
    const base = { lines: [{ gross: 100_000, ratePct: 10 }], buyerShipping: 0, settings: normal };
    expect(estimateOrderFee({ ...base, date: "2025-06-30" })!.infra).toBe(0);
    expect(estimateOrderFee({ ...base, date: "2025-07-01" })!.infra).toBe(3_000);
    expect(estimateOrderFee({ ...base, date: null })!.infra).toBe(3_000);
  });

  it("ưu đãi người bán mới: ≥ 6% trừ 3 điểm, < 6% giảm một nửa, chỉ trong 01/06–31/08/2026 và chỉ shop thường", () => {
    const nw = { sellerType: "non_mall", newSeller: true } as const;
    expect(effectiveFixedRate(17, "2026-07-15", nw)).toBe(14);
    expect(effectiveFixedRate(2, "2026-07-15", nw)).toBe(1);
    expect(effectiveFixedRate(6, "2026-06-01", nw)).toBe(3);
    expect(effectiveFixedRate(17, "2026-05-31", nw)).toBe(17);
    expect(effectiveFixedRate(17, "2026-09-01", nw)).toBe(17);
    expect(effectiveFixedRate(17, "2026-07-15 10:30", nw)).toBe(14);
    expect(effectiveFixedRate(17, "2026-07-15", normal)).toBe(17);
    expect(effectiveFixedRate(17, "2026-07-15", { sellerType: "mall", newSeller: true })).toBe(17);
  });
});

import { estimateManualFee, estimateTiktokFee } from "./estimate";

describe("ước tính phí TikTok Shop", () => {
  const settings = { tiktokSellerType: "non_mall", tiktokAffiliatePct: 0 } as const;
  const line = (gross: number, ratePct: number | null) => ({ gross, ratePct });

  it("hoa hồng ngành + Phí Giao Dịch 6% (gồm ship khách trả) + Phí Xử Lý 3.000đ", () => {
    const e = estimateTiktokFee({ date: "2026-10-01", returned: false, lines: [line(100_000, 15)], buyerShipping: 5_600, settings })!;
    expect(e.commission).toBe(15_000);
    expect(e.transaction).toBe(6_336); // đúng ví dụ của TikTok: 6% × 105.600
    expect(e.processing).toBe(3_000);
    expect(e.affiliate).toBe(0);
    expect(e.total).toBe(24_336);
  });

  it("ngành chưa rõ dùng mức mặc định theo loại shop và được đếm", () => {
    const std = estimateTiktokFee({ date: "2026-10-01", returned: false, lines: [line(100_000, null)], buyerShipping: 0, settings })!;
    expect(std.commission).toBe(14_000);
    expect(std.defaulted).toBe(1);
    const mall = estimateTiktokFee({ date: "2026-10-01", returned: false, lines: [line(100_000, null)], buyerShipping: 0, settings: { ...settings, tiktokSellerType: "mall" } })!;
    expect(mall.commission).toBe(16_000);
  });

  it("affiliate tính theo tỷ lệ người bán nhập", () => {
    const e = estimateTiktokFee({ date: "2026-10-01", returned: false, lines: [line(200_000, 10)], buyerShipping: 0, settings: { ...settings, tiktokAffiliatePct: 5 } })!;
    expect(e.affiliate).toBe(10_000);
    expect(e.total).toBe(20_000 + 12_000 + 3_000 + 10_000);
  });

  it("đơn hoàn trả chỉ còn Phí Xử Lý; đơn trước 27/10/2025 không có Phí Xử Lý", () => {
    const r = estimateTiktokFee({ date: "2026-10-01", returned: true, lines: [line(100_000, 15)], buyerShipping: 5_000, settings })!;
    expect(r.total).toBe(3_000);
    const old = estimateTiktokFee({ date: "2025-10-26", returned: false, lines: [line(100_000, 15)], buyerShipping: 0, settings })!;
    expect(old.processing).toBe(0);
  });

  it("đơn không có giá trị thì không ước tính", () => {
    expect(estimateTiktokFee({ date: "2026-10-01", returned: false, lines: [], buyerShipping: 0, settings })).toBeNull();
    expect(estimateTiktokFee({ date: "2026-10-01", returned: false, lines: [line(0, 10)], buyerShipping: 0, settings })).toBeNull();
  });
});

describe("phí tự nhập (Lazada, Tiki...)", () => {
  it("(hoa hồng + thanh toán) × giá trị + phí cố định mỗi đơn", () => {
    expect(estimateManualFee({ commissionPct: 4, paymentPct: 2, perOrder: 1_000 }, [{ gross: 100_000 }, { gross: 50_000 }], false)).toBe(10_000);
  });
  it("đơn hoàn trả chỉ còn phí cố định; đơn rỗng không ước tính", () => {
    expect(estimateManualFee({ commissionPct: 4, paymentPct: 2, perOrder: 1_000 }, [{ gross: 100_000 }], true)).toBe(1_000);
    expect(estimateManualFee({ commissionPct: 4, paymentPct: 2, perOrder: 1_000 }, [], false)).toBeNull();
  });
});
