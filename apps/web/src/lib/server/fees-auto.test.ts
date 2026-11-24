import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_FEE_SETTINGS } from "@/lib/fees/constants";
import { feePayload, makeFeeEstimator, type FeeConfig } from "./fees";

const cfg = (over: Partial<FeeConfig> = {}, enabled = true): FeeConfig => ({
  available: true,
  settings: { ...DEFAULT_FEE_SETTINGS, enabled },
  categories: new Map(),
  ship: { available: true, rates: {} },
  signature: "t",
  ...over,
});

const order = (product: string, sku: string | null = null) => ({
  channel: "Shopee",
  date: "2026-06-10",
  status: "Hoàn thành" as const,
  shippingIn: 0,
  lines: [{ sku, product, variant: null, quantity: 1, revenue: 100_000, discount: 0, cost: 50_000, gross: 100_000 }],
});

describe("ước tính phí với ngành tự nhận diện", () => {
  it("sản phẩm chưa chọn ngành dùng ngành tự nhận diện; tên lạ thì chưa ước tính", () => {
    const est = makeFeeEstimator(cfg())!;
    expect(est(order("Chảo chống dính 24cm"))).toBeGreaterThan(0);
    expect(est(order("xyz abc qwerty"))).toBeNull();
  });

  it("ngành người bán đã chọn thắng ngành tự nhận diện", () => {
    const chosen = makeFeeEstimator(cfg({ categories: new Map([["chao-1", "Sắc Đẹp › Chăm sóc da mặt › Sữa rửa mặt"]]) }))!;
    const auto = makeFeeEstimator(cfg())!;
    // Sữa rửa mặt 17% vs Chảo 16%: phí khác nhau chứng tỏ dùng ngành đã chọn.
    expect(chosen(order("Chảo chống dính 24cm", "CHAO-1"))).not.toBe(auto(order("Chảo chống dính 24cm", "CHAO-1")));
  });

  it("tắt ước tính thì không có bộ ước tính, kể cả khi đoán được ngành", () => {
    expect(makeFeeEstimator(cfg({}, false))).toBeUndefined();
  });

  it("chỉ ước tính cho Shopee", () => {
    expect(makeFeeEstimator(cfg())!({ ...order("Chảo chống dính 24cm"), channel: "TikTok Shop" })).toBeNull();
  });

  it("payload gợi ý ngành cho sản phẩm chưa chọn, bỏ sản phẩm đã chọn và tên không đoán được", () => {
    const p = feePayload(cfg({ categories: new Map([["sp-2", "Sắc Đẹp › Chăm sóc da mặt › Sữa rửa mặt"]]) }), [
      { key: "SP-1", name: "Chảo chống dính 24cm" },
      { key: "SP-2", name: "Chảo chống dính 24cm" },
      { key: "SP-3", name: "xyz abc qwerty" },
    ]);
    expect(Object.keys(p.suggestions)).toEqual(["sp-1"]);
    expect(p.suggestions["sp-1"].path).toBe("Nhà cửa & Đời sống › Dụng cụ nhà bếp › Chảo");
  });
});
