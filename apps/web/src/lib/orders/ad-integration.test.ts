import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyAdSpend } from "@/lib/profit/ad-spend";
import { buildOrders } from "@/lib/profit/order-profit";
import { prepareAdSpend } from "./ad-file";
import { COL } from "./canonical";
import { mergeOrders } from "./merge";
import { prepareImport } from "./prepare";

/** Cả chuỗi: file đơn mô phỏng (Shopee + TikTok) → file chi phí quảng cáo theo ngày → lãi từng đơn. */
const load = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./sample-files/${name}`, import.meta.url))));

describe("chi phí quảng cáo theo ngày trên file đơn mô phỏng", () => {
  it("tổng chi phí chia cho đơn đúng bằng tổng trong file quảng cáo (phần có đơn để chia)", async () => {
    const shopee = await prepareImport(load("MO-PHONG_Shopee_Order.all.20261101_20261115.xlsx"), "shopee.xlsx", {});
    const tiktok = await prepareImport(load("MO-PHONG_TikTokShop_OrderSKUList_2026-11.xlsx"), "tiktok.xlsx", {});
    const rows = mergeOrders(mergeOrders([], shopee.normalized!.rows, shopee.normalized!.keyed), tiktok.normalized!.rows, tiktok.normalized!.keyed);

    // Lấy các ngày thật có đơn của từng kênh để dựng file quảng cáo khớp.
    const days = (ch: string) => [...new Set(rows.filter((r) => r[COL.channel] === ch).map((r) => String(r[COL.date]).slice(0, 10)))].sort();
    const sd = days("Shopee");
    const td = days("TikTok Shop");
    expect(sd.length).toBeGreaterThan(1);
    const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

    const shopeeAds = await prepareAdSpend(new TextEncoder().encode(["Ngày,Chiến dịch,Chi phí", ...sd.flatMap((d, i) => [`${dm(d)},A,${(i + 1) * 10_000}`, `${dm(d)},B,5000`]), "Tổng,,999999999"].join("\n")), "sa.csv", { channel: "Shopee" });
    expect(shopeeAds.problems).toEqual([]);
    const shopeeTotal = sd.reduce((n, _, i) => n + (i + 1) * 10_000 + 5000, 0);
    expect(shopeeAds.summary?.total).toBe(shopeeTotal);

    // Một ngày chạy quảng cáo nhưng không có đơn nào: phải báo chưa chia được, không mất tiền âm thầm.
    const lonely = { channel: "TikTok Shop", day: "2020-01-01", amount: 77_000 };
    const tiktokEntries = td.map((d) => ({ channel: "TikTok Shop", day: d, amount: 20_000 }));

    const before = buildOrders(rows);
    const res = applyAdSpend(rows, [...shopeeAds.entries, ...tiktokEntries, lonely]);
    const after = buildOrders(res.rows);

    const adOf = (list: ReturnType<typeof buildOrders>, ch: string) => list.filter((o) => o.channel === ch).reduce((n, o) => n + o.adCost, 0);
    expect(adOf(after, "Shopee")).toBe(shopeeTotal);
    expect(adOf(after, "TikTok Shop")).toBe(20_000 * td.length);
    expect(res.unallocated).toEqual([lonely]);
    expect(res.allocated).toBe(shopeeTotal + 20_000 * td.length);

    // Quảng cáo chỉ làm lãi từng đơn giảm đúng bằng phần đã chia cho đơn đó.
    let checked = 0;
    after.forEach((o, i) => {
      const was = before[i];
      if (o.profit === null || was.profit === null) return;
      expect(o.profit).toBeCloseTo(was.profit - (o.adCost - was.adCost), 6);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
    expect(after.length).toBe(before.length);
    expect(res.rows.length).toBe(rows.length);
  });
});
