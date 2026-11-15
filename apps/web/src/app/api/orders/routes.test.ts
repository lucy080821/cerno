import { NextRequest, NextResponse } from "next/server";
import writeExcelFile from "write-excel-file/node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/orders/fake-db";
import { SHOPEE_TABLE, TIKTOK_TABLE } from "@/lib/orders/fixtures";

const state = vi.hoisted(() => ({ authed: true, db: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/alerts/after-change", () => ({ evaluateAlertsAfterChange: async () => undefined }));
vi.mock("@/lib/server/row-cache", () => ({ invalidateSourceCache: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => (state.db as FakeDb).client() }));
vi.mock("@/lib/orders/request", async (orig) => ({
  ...(await orig<typeof import("@/lib/orders/request")>()),
  requireEditor: async () =>
    state.authed
      ? { ok: true, supabase: (state.db as FakeDb).client(), user: { id: "u1" }, workspaceId: "ws-1" }
      : { ok: false, response: NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 }) },
}));

import { POST as inspect } from "./inspect/route";
import { POST as importRoute } from "./import/route";

async function xlsx(table: unknown[][]) {
  return new Uint8Array(await writeExcelFile(table as never).toBuffer());
}
function upload(url: string, file: Uint8Array | string | null, name: string, extra: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const fd = new FormData();
  if (file !== null) fd.set("file", new File([file as BlobPart], name));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return new NextRequest(`http://localhost${url}`, { method: "POST", body: fd, headers: { origin: "http://localhost", host: "localhost", ...headers } });
}

let db: FakeDb;
beforeEach(() => {
  db = new FakeDb();
  state.db = db;
  state.authed = true;
});

describe("POST /api/orders/inspect", () => {
  it("nhận diện file Shopee, trả tóm tắt và xem trước, không rò thông tin người mua", async () => {
    const res = await inspect(upload("/api/orders/inspect", await xlsx(SHOPEE_TABLE as unknown[][]), "Order.all.xlsx"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ profile: "shopee", channel: "Shopee", problems: [], sheet: "Sheet1" });
    expect(json.summary).toMatchObject({ orders: 3, lines: 4, keyed: true, netRevenue: 560_000 });
    expect(json.preview).toHaveLength(4);
    expect(JSON.stringify(json)).not.toContain("SECRET");
    expect(db.sources).toHaveLength(0); // xem trước không ghi gì
  });

  it("chấp nhận ánh xạ do người dùng chỉnh", async () => {
    const csv = "Ngày bán,Hàng,Tiền,Tiền khác\n05/09/2025,Áo,100,999\n";
    const first = await (await inspect(upload("/api/orders/inspect", csv, "a.csv", { channel: "Facebook" }))).json();
    expect(first.problems.join(" ")).toMatch(/thành tiền/);
    const fixed = await (await inspect(upload("/api/orders/inspect", csv, "a.csv", { channel: "Facebook", mapping: JSON.stringify({ date: [0], revenue: [3], product: [1] }) }))).json();
    expect(fixed.problems).toEqual([]);
    expect(fixed.summary.netRevenue).toBe(999);
  });

  it("từ chối khi chưa đăng nhập, thiếu file, gửi chéo trang, ánh xạ hỏng hoặc file không phải đơn hàng", async () => {
    state.authed = false;
    expect((await inspect(upload("/api/orders/inspect", "a,b\n1,2", "a.csv"))).status).toBe(401);
    state.authed = true;
    expect((await inspect(upload("/api/orders/inspect", null, "a.csv"))).status).toBe(400);
    expect((await inspect(upload("/api/orders/inspect", "a,b\n1,2", "a.csv", {}, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await inspect(upload("/api/orders/inspect", "a,b\n1,2", "a.csv", { mapping: "{không phải json" }))).status).toBe(400);
    const bad = await inspect(upload("/api/orders/inspect", "a,b,c\n1,2,3\n", "a.csv"));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toMatch(/không tìm thấy bảng đơn hàng/i);
  });
});

describe("POST /api/orders/import", () => {
  it("nhập file vào nguồn đơn hàng rồi gộp file kênh khác", async () => {
    const r1 = await importRoute(upload("/api/orders/import", await xlsx(SHOPEE_TABLE as unknown[][]), "shopee.xlsx"));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ created: true, channel: "Shopee", lines: 4, orders: 3, totalRows: 4 });
    const r2 = await importRoute(upload("/api/orders/import", await xlsx(TIKTOK_TABLE as unknown[][]), "tiktok.xlsx"));
    expect(await r2.json()).toMatchObject({ created: false, channel: "TikTok Shop", totalRows: 6 });
    expect(db.sources).toHaveLength(1);
    expect(JSON.stringify([...db.rows.values()])).not.toContain("SECRET");
  });

  it("không ghi gì khi file thiếu thông tin hoặc chưa chọn kênh", async () => {
    const res = await importRoute(upload("/api/orders/import", "Ngày,Thành tiền\n05/09/2025,100\n", "a.csv"));
    expect(res.status).toBe(422);
    expect((await res.json()).problems).toContain("Chưa chọn kênh bán.");
    expect(db.sources).toHaveLength(0);
  });

  it("trả 401 khi chưa đăng nhập và 403 khi gửi chéo trang", async () => {
    state.authed = false;
    expect((await importRoute(upload("/api/orders/import", "x", "a.csv"))).status).toBe(401);
    state.authed = true;
    expect((await importRoute(upload("/api/orders/import", "x", "a.csv", {}, { origin: "https://evil.example" }))).status).toBe(403);
  });
});
