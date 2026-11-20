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
