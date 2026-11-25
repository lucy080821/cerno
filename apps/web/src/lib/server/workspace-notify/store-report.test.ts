import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Row } from "@dashboard/chart-engine";
import { prepareImport } from "@/lib/orders/prepare";
import { mergeOrders } from "@/lib/orders/merge";
import { applyCatalogCosts, catalogMap } from "@/lib/profit/catalog";
import { buildOrders, summarize, type ProfitSummary } from "@/lib/profit/order-profit";
import { inRange } from "@/lib/profit/period";
import type { ProviderOutcome } from "@/lib/server/ai/types";
import { createComposeCaches, type ReportConfig } from "@/lib/server/reports/compose";
import { reportPeriods } from "@/lib/server/reports/period";
import { storeWording } from "@/lib/server/mail/store-wording";
import { buildStoreReportFacts, validOrders } from "./report-facts";
import { composeStoreReport, type StoreComposeDeps } from "./report-compose";

/** Báo cáo theo cửa hàng chạy trên dữ liệu bán hàng đa kênh (file mô phỏng), số liệu lấy từ summarize() của các trang lãi. */
const load = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../orders/sample-files/${name}`, import.meta.url))));
const COSTS = [["AO-001", 62000], ["BGN-002", 90000], ["TOTE-003", 50000], ["SRM-004", 76000], ["KCN-005", 118000], ["CHAO-006", 160000], ["DEN-007", 139000], ["KHAN-008", 41000]] as const;

async function orders() {
  let all: Row[] = [];
  for (const n of ["MO-PHONG_Shopee_Order.all.20261101_20261115.xlsx", "MO-PHONG_TikTokShop_OrderSKUList_2026-11.xlsx"]) {
    const p = await prepareImport(load(n), n, {});
    all = mergeOrders(all, p.normalized!.rows, p.normalized!.keyed);
  }
  all = applyCatalogCosts(all, catalogMap(COSTS.map(([sku, unitCost]) => ({ sku, unitCost })))).rows;
  return buildOrders(all);
}

// Báo cáo hằng ngày chạy sáng 13/11/2026 (giờ VN): kỳ báo cáo = 12/11, kỳ trước = 11/11.
const NOW = new Date("2026-11-13T01:00:00Z");
const cfg: ReportConfig = { frequency: "daily", recipient_name: "An", prompt: "", widget_ids: [], include_images: true, link_mode: "login" };

const NO_AI = (): ProviderOutcome => ({ ok: false, provider: "groq", status: 503, body: { error: "tắt" }, fallbackable: false });

function deps(all: Awaited<ReturnType<typeof orders>>, over: Partial<StoreComposeDeps> = {}): StoreComposeDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    loadStore: async () => ({ id: "ws1", name: "Tiệm Hoa Nắng", ownerId: "owner", updatedAt: "2026-11-13T00:30:00Z", hasOrders: true }),
    summarize: async (_ws, range) => { calls.push(`${range.from}..${range.to}`); return summarize(all.filter((o) => inRange(o.date, range))); },
    chat: () => async () => NO_AI(),
    origin: "https://cerno.cloud",
    ...over,
  };
}

describe("gói số liệu báo cáo theo cửa hàng", () => {
  it("KPI khớp summarize() của kỳ và kỳ trước; so sánh đúng chiều", async () => {
    const all = await orders();
    const p = reportPeriods("weekly", new Date("2026-11-16T01:00:00Z")); // 9–15/11 vs 2–8/11
    const cur = summarize(all.filter((o) => inRange(o.date, p.cur)));
    const prev = summarize(all.filter((o) => inRange(o.date, p.prev)));
    expect(cur.orders).toBeGreaterThan(0);
    expect(prev.orders).toBeGreaterThan(0);
    const f = buildStoreReportFacts({ cur, prev, periods: p, updatedAt: null });
    const k = (id: string) => f.kpis.find((x) => x.widgetId === `ws-${id}`)!;
    expect(k("revenue").value!.value).toBe(cur.allRevenue);
    expect(k("revenue").prev!.value).toBe(prev.allRevenue);
    expect(k("profit").value!.value).toBe(cur.profit);
    expect(k("orders").value!.value).toBe(validOrders(cur));
    expect(k("cancelRate").value!.value).toBeCloseTo((cur.cancelled / cur.orders) * 100, 1);
    // Tăng doanh thu → mũi tên lên, xanh; tăng tỷ lệ hủy → đỏ.
    const up = cur.allRevenue > prev.allRevenue;
    expect(k("revenue").dir).toBe(up ? "up" : "down");
    expect(k("revenue").tone).toBe(up ? "good" : "bad");
    if (k("cancelRate").dir === "up") expect(k("cancelRate").tone).toBe("bad");
    // Kênh bán là nhóm tăng/giảm đầu tiên.
    expect(f.movers[0]).toMatchObject({ dimension: "Kênh", metric: "Lãi" });
    expect(new TextEncoder().encode(JSON.stringify(f)).length).toBeLessThanOrEqual(6000);
  });

  it("tổng quan: không có kỳ trước, có nhóm dẫn đầu", async () => {
    const all = await orders();
    const p = reportPeriods("weekly", new Date("2026-11-16T01:00:00Z"));
    const cur = summarize(all.filter((o) => inRange(o.date, p.cur)));
    const f = buildStoreReportFacts({ cur, prev: summarize([]), periods: p, updatedAt: null, mode: "overview" });
    expect(f.mode).toBe("overview");
    expect(f.kpis.every((x) => x.prev === null && x.growthText === "")).toBe(true);
    expect(f.movers).toEqual([]);
    expect(f.tops?.map((t) => t.dimension)).toEqual(["Kênh", "Sản phẩm"]);
  });

  it("kỳ không có đơn: ghi chú và KPI trống (không bịa số 0)", () => {
    const empty: ProfitSummary = summarize([]);
    const f = buildStoreReportFacts({ cur: empty, prev: empty, periods: reportPeriods("daily", NOW), updatedAt: null });
    expect(f.notes.join(" ")).toContain("Không có đơn hàng");
    expect(f.kpis.every((x) => x.value === null)).toBe(true);
  });
});

describe("composeStoreReport", () => {
  it("ráp email từ dữ liệu cửa hàng: chữ 'cửa hàng', không nhắc dashboard, có biểu đồ, mở trang Tổng quan", async () => {
    const all = await orders();
    const d = deps(all);
    const r = await composeStoreReport(d, "ws1", { ...cfg, frequency: "weekly" }, { now: new Date("2026-11-16T01:00:00Z"), caches: createComposeCaches(), unsubscribeUrl: "https://cerno.cloud/unsubscribe?t=x" });
    if (!r.ok) throw new Error(r.error);
    expect(r.dashboardName).toBe("Tiệm Hoa Nắng");
    expect(r.email.html).toContain("Tiệm Hoa Nắng");
    expect(r.email.html).toContain("https://cerno.cloud/overview");
    expect(r.email.html).toContain("Mở Cerno");
    expect(r.email.html + r.email.text).not.toMatch(/dashboard/i);
    // Phần tiếng Anh dùng tên chỉ số bằng tiếng Anh, phần tiếng Việt giữ tiếng Việt.
    const [vi, en] = r.email.text.split("----- ENGLISH VERSION -----");
    expect(vi).toContain("- Tỷ lệ hủy (%):");
    expect(en).toContain("- Cancellation rate (%):");
    expect(en).toContain("- Net revenue:");
    expect(en).toContain("Sales channel");
    expect(r.images.length).toBe(3);
    expect(r.images.every((i) => i.content.length > 1000 && i.contentType === "image/png")).toBe(true);
    expect(r.meta.ai).toMatchObject({ used: false });
    expect(r.meta.images).toBe(3);
  });

  it("gói không có AI: không gọi AI; người nhận cùng kỳ dùng chung số liệu (mỗi khoảng ngày chỉ tính một lần)", async () => {
    const all = await orders();
    let chat = 0;
    const d = deps(all, { chat: () => async () => { chat++; return NO_AI(); }, aiAllowed: async () => false });
    const caches = createComposeCaches();
    const o = { now: new Date("2026-11-16T01:00:00Z"), caches, unsubscribeUrl: "u" };
    await composeStoreReport(d, "ws1", { ...cfg, frequency: "weekly" }, o);
    const first = d.calls.length;
    await composeStoreReport(d, "ws1", { ...cfg, frequency: "weekly", recipient_name: "Bình" }, o);
    expect(d.calls.length).toBe(first);
    expect(chat).toBe(0);
  });

  it("cửa hàng chưa có đơn hàng hoặc không tồn tại: lỗi rõ ràng, không gửi", async () => {
    const all = await orders();
    const o = { now: NOW, caches: createComposeCaches(), unsubscribeUrl: "u" };
    const none = await composeStoreReport(deps(all, { loadStore: async () => ({ id: "w", name: "X", ownerId: "o", updatedAt: null, hasOrders: false }) }), "w", cfg, o);
    expect(none).toMatchObject({ ok: false });
    const gone = await composeStoreReport(deps(all, { loadStore: async () => null }), "w", cfg, o);
    expect(gone).toMatchObject({ ok: false, error: expect.stringContaining("không còn tồn tại") });
  });

  it("tắt ảnh thì không vẽ ảnh", async () => {
    const all = await orders();
    const r = await composeStoreReport(deps(all), "ws1", { ...cfg, include_images: false, frequency: "weekly" }, { now: new Date("2026-11-16T01:00:00Z"), caches: createComposeCaches(), unsubscribeUrl: "u" });
    if (!r.ok) throw new Error(r.error);
    expect(r.images).toEqual([]);
  });
});

describe("storeWording", () => {
  it("đổi các cụm cố định nhắc tới dashboard, giữ nguyên phần còn lại", () => {
    const m = storeWording({
      subject: "[Cerno] X",
      html: "Dưới đây là số liệu của dashboard “X”. Mở dashboard · Open dashboard. Bạn nhận email này vì được đăng ký nhận báo cáo định kỳ của dashboard này. this dashboard&#39;s scheduled reports. see the dashboard if",
      text: "Mở dashboard / Open dashboard",
    });
    expect(m.html).toBe("Dưới đây là số liệu của cửa hàng “X”. Mở Cerno · Open Cerno. Bạn nhận email này vì được đăng ký nhận báo cáo định kỳ của cửa hàng này. this store's scheduled reports. see Cerno if");
    expect(m.text).toBe("Mở Cerno / Open Cerno");
  });
});
