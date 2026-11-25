import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_FEE_SETTINGS } from "@/lib/fees/constants";
import { cleanManualRates, feePayload, makeFeeEstimator, type FeeConfig } from "./fees";

const SHOPEE_SUA = "Sắc Đẹp › Chăm sóc da mặt › Sữa rửa mặt";
const TIKTOK_SUA = "Chăm sóc sắc đẹp & Chăm sóc cá nhân › Chăm sóc da › Sữa rửa mặt";

const cfg = (over: Partial<FeeConfig> = {}, enabled = true): FeeConfig => ({
  available: true,
  multiPlatform: true,
  settings: { ...DEFAULT_FEE_SETTINGS, enabled },
  categories: { Shopee: new Map(), "TikTok Shop": new Map() },
  manual: { available: true, rates: {} },
  ship: { available: true, rates: {} },
  signature: "t",
  ...over,
});

const order = (product: string, sku: string | null = null, channel = "Shopee", status: "Hoàn thành" | "Hoàn trả" = "Hoàn thành") => ({
  channel,
  date: "2026-11-10",
  status,
  shippingIn: 0,
  lines: [{ sku, product, variant: null, quantity: 1, revenue: 100_000, discount: 0, cost: 50_000, gross: 100_000 }],
});

describe("ước tính phí với ngành tự nhận diện (Shopee)", () => {
  it("sản phẩm chưa chọn ngành dùng ngành tự nhận diện; tên lạ dùng mức mặc định (không để trống phí)", () => {
    const est = makeFeeEstimator(cfg())!;
    const known = est(order("Chảo chống dính 24cm"))!;
    const unknown = est(order("xyz abc qwerty"))!;
    expect(known).toBeGreaterThan(0);
    expect(unknown).toBeGreaterThan(0);
    // Cùng giá trị dòng: khác nhau chỉ ở mức Phí Cố Định (chảo 16% so với mặc định 15,5%).
    expect(known).toBeGreaterThan(unknown);
  });

  it("ngành người bán đã chọn thắng ngành tự nhận diện", () => {
    const chosen = makeFeeEstimator(cfg({ categories: { Shopee: new Map([["chao-1", SHOPEE_SUA]]), "TikTok Shop": new Map() } }))!;
    const auto = makeFeeEstimator(cfg())!;
    // Sữa rửa mặt 17% vs Chảo 16%: phí khác nhau chứng tỏ dùng ngành đã chọn.
    expect(chosen(order("Chảo chống dính 24cm", "CHAO-1"))).not.toBe(auto(order("Chảo chống dính 24cm", "CHAO-1")));
  });

  it("tắt ước tính thì không có bộ ước tính, kể cả khi đoán được ngành", () => {
    expect(makeFeeEstimator(cfg({}, false))).toBeUndefined();
  });

  it("kênh không có biểu phí và chưa nhập tỷ lệ thì không ước tính", () => {
    expect(makeFeeEstimator(cfg())!({ ...order("Chảo chống dính 24cm"), channel: "Lazada" })).toBeNull();
  });

  it("biến thể thừa hưởng ngành của mã gốc", () => {
    const est = makeFeeEstimator(cfg({ categories: { Shopee: new Map([["sp-1", SHOPEE_SUA]]), "TikTok Shop": new Map() } }))!;
    expect(est(order("Chảo chống dính 24cm", "SP-1-DO"))).toBe(est(order("Chảo chống dính 24cm", "SP-1")));
  });
});

describe("ước tính phí TikTok Shop", () => {
  it("đơn TikTok Shop có phí; ngành chưa rõ vẫn ước tính bằng mức mặc định", () => {
    const est = makeFeeEstimator(cfg())!;
    // Tên lạ: hoa hồng mặc định 14% = 14.000, Phí Giao Dịch 6.000, Phí Xử Lý 3.000.
    expect(est(order("xyz abc qwerty", null, "TikTok Shop"))).toBe(14_000 + 6_000 + 3_000);
  });

  it("ngành người bán chọn cho TikTok Shop dùng biểu của TikTok", () => {
    const est = makeFeeEstimator(cfg({ categories: { Shopee: new Map(), "TikTok Shop": new Map([["sp-1", TIKTOK_SUA]]) } }))!;
    expect(est(order("xyz", "SP-1", "TikTok Shop"))).toBe(15_500 + 6_000 + 3_000);
  });

  it("đơn hoàn trả chỉ còn Phí Xử Lý; affiliate cộng vào", () => {
    const est = makeFeeEstimator(cfg())!;
    expect(est(order("xyz abc qwerty", null, "TikTok Shop", "Hoàn trả"))).toBe(3_000);
    const aff = makeFeeEstimator(cfg({ settings: { ...DEFAULT_FEE_SETTINGS, enabled: true, tiktokAffiliatePct: 10 } }))!;
    expect(aff(order("xyz abc qwerty", null, "TikTok Shop"))).toBe(14_000 + 6_000 + 3_000 + 10_000);
  });

  it("loại shop Mall dùng mức mặc định 16%", () => {
    const est = makeFeeEstimator(cfg({ settings: { ...DEFAULT_FEE_SETTINGS, enabled: true, tiktokSellerType: "mall" } }))!;
    expect(est(order("xyz abc qwerty", null, "TikTok Shop"))).toBe(16_000 + 6_000 + 3_000);
  });
});

describe("phí tự nhập cho Lazada, Tiki", () => {
  it("dùng tỷ lệ người bán nhập, kể cả khi tắt ước tính theo biểu phí", () => {
    const manual = { available: true, rates: { Lazada: { commissionPct: 4, paymentPct: 2, perOrder: 1_000 } } };
    const est = makeFeeEstimator(cfg({ manual }, false))!;
    expect(est(order("Chảo", null, "Lazada"))).toBe(7_000);
    expect(est(order("Chảo", null, "Tiki"))).toBeNull();
    expect(est(order("Chảo", null, "Shopee"))).toBeNull();
  });

  it("làm sạch: bỏ kênh không hợp lệ (cả Shopee/TikTok Shop), số ngoài khoảng, và kênh toàn 0", () => {
    const r = cleanManualRates({
      Lazada: { commissionPct: 4.123, paymentPct: 2, perOrder: 1000.4 },
      Tiki: { commissionPct: 0, paymentPct: 0, perOrder: 0 },
      Shopee: { commissionPct: 5, paymentPct: 0, perOrder: 0 },
      "TikTok Shop": { commissionPct: 5, paymentPct: 0, perOrder: 0 },
      Khác: { commissionPct: 99, paymentPct: 0, perOrder: 0 },
      Zalo: { commissionPct: 1, paymentPct: 1, perOrder: 1 },
    });
    expect(r).toEqual({ Lazada: { commissionPct: 4.12, paymentPct: 2, perOrder: 1000 } });
  });
});

describe("payload gửi cho trình duyệt", () => {
  const products = [
    { key: "SP-1", name: "Chảo chống dính 24cm", channels: ["Shopee", "TikTok Shop"] },
    { key: "SP-2", name: "Chảo chống dính 24cm", channels: ["Shopee"] },
    { key: "SP-3", name: "xyz abc qwerty", channels: ["Shopee", "TikTok Shop"] },
    { key: "SP-2-DO", name: "Chảo chống dính 24cm", channels: ["Shopee"] },
  ];
  const p = feePayload(cfg({ categories: { Shopee: new Map([["sp-2", SHOPEE_SUA]]), "TikTok Shop": new Map() } }), products);

  it("gợi ý ngành theo từng sàn, chỉ cho sản phẩm có bán ở sàn đó, bỏ sản phẩm đã chọn và tên không đoán được", () => {
    expect(Object.keys(p.platforms.Shopee.suggestions)).toEqual(["sp-1"]);
    expect(p.platforms.Shopee.suggestions["sp-1"].path).toBe("Nhà cửa & Đời sống › Dụng cụ nhà bếp › Chảo");
    expect(Object.keys(p.platforms["TikTok Shop"].suggestions)).toEqual(["sp-1"]);
    expect(p.platforms["TikTok Shop"].suggestions["sp-1"].path).toBe("Đồ dùng nhà bếp › Đồ nấu ăn › Xoong & Chảo");
  });

  it("biến thể hiện ngành thừa hưởng từ mã gốc như ngành đã chọn", () => {
    expect(p.platforms.Shopee.categories["sp-2-do"]?.path).toBe(SHOPEE_SUA);
    expect(p.platforms.Shopee.suggestions["sp-2-do"]).toBeUndefined();
  });
});
