import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Row } from "@dashboard/chart-engine";

const { alerts, invalidate } = vi.hoisted(() => ({ alerts: vi.fn(async (_id: string) => undefined), invalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/alerts/after-change", () => ({ evaluateAlertsAfterChange: alerts }));
vi.mock("@/lib/server/row-cache", () => ({ invalidateSourceCache: invalidate }));

import { COL, ORDERS_SHEET_NAME, ORDERS_SPREADSHEET_ID, ORDER_COLUMNS } from "./canonical";
import { FakeDb } from "./fake-db";
import { ImportError, importOrders } from "./import";
import { MAX_ROWS_PER_WORKSPACE, MAX_SOURCES_PER_WORKSPACE } from "@/lib/limits";
import { SHOPEE_TABLE, TIKTOK_TABLE } from "./fixtures";
import { detectSheet } from "./detect";
import { normalizeOrders } from "./normalize";
import type { Prepared } from "./prepare";

const WS = "ws-1";

function prepared(table: typeof SHOPEE_TABLE, channel: "Shopee" | "TikTok Shop"): Prepared {
  const d = detectSheet(table)!;
  return {
    filename: "x.xlsx", sheetNames: ["s"], sheet: "s", headerRow: d.headerRow, headers: d.headers, profile: d.profile, profileLabel: "",
    channel, mapping: d.mapping, problems: [], normalized: normalizeOrders(table, d.headerRow, d.mapping, channel),
  };
}

let db: FakeDb;
const run = (p: Prepared) => importOrders({ user: db.client(), admin: db.client(), userId: "u1", workspaceId: WS, prepared: p });
const stored = (id: string) => (db.rows.get(id) ?? []) as Row[];

beforeEach(() => {
  db = new FakeDb();
  alerts.mockClear();
  invalidate.mockClear();
});

describe("importOrders", () => {
  it("lần đầu tạo nguồn 'Đơn hàng đa kênh' và ghi toàn bộ dòng", async () => {
    const res = await run(prepared(SHOPEE_TABLE, "Shopee"));
    expect(res.created).toBe(true);
    expect(res.lines).toBe(4);
    expect(res.orders).toBe(3);
    expect(res.totalRows).toBe(4);
    const src = db.sources[0];
    expect(src).toMatchObject({ workspace_id: WS, spreadsheet_id: ORDERS_SPREADSHEET_ID, sheet_name: ORDERS_SHEET_NAME, name: "Đơn hàng đa kênh", row_count: 4, last_error: null });
    expect(src.columns).toEqual(ORDER_COLUMNS);
    expect(stored(src.id)).toHaveLength(4);
    expect(invalidate).toHaveBeenCalledWith(src.id);
    expect(alerts).toHaveBeenCalledWith(src.id);
  });

  it("file thứ hai của kênh khác được gộp vào cùng nguồn; mỗi lần nhập đổi dấu vân tay để bộ nhớ đệm làm mới", async () => {
    await run(prepared(SHOPEE_TABLE, "Shopee"));
    const hash1 = db.sources[0].last_sync_hash;
    const res = await run(prepared(TIKTOK_TABLE, "TikTok Shop"));
    expect(res.created).toBe(false);
    expect(db.sources).toHaveLength(1);
    expect(res.totalRows).toBe(6);
    expect(new Set(stored(db.sources[0].id).map((r) => r[COL.channel]))).toEqual(new Set(["Shopee", "TikTok Shop"]));
    expect(db.sources[0].last_sync_hash).not.toBe(hash1);
  });

  it("tải lại cùng file không nhân đôi dòng (gộp theo mã đơn)", async () => {
    await run(prepared(SHOPEE_TABLE, "Shopee"));
    const res = await run(prepared(SHOPEE_TABLE, "Shopee"));
    expect(res.totalRows).toBe(4);
    expect(stored(db.sources[0].id)).toHaveLength(4);
  });

  it("hai lần tải đồng thời vào cùng workspace không làm mất dữ liệu của nhau", async () => {
    db.delayMs = 3; // ép các lời gọi xen kẽ nhau
    const [a, b] = await Promise.all([run(prepared(SHOPEE_TABLE, "Shopee")), run(prepared(TIKTOK_TABLE, "TikTok Shop"))]);
    expect(db.sources).toHaveLength(1);
    const rows = stored(db.sources[0].id);
    expect(rows).toHaveLength(6); // 4 dòng Shopee + 2 dòng TikTok, cả hai file đều còn
    expect(Math.max(a.totalRows, b.totalRows)).toBe(6);
    expect(db.sources[0].row_count).toBe(6);
  });

  it("một lần nhập lỗi không chặn các lần sau trong hàng đợi", async () => {
    db.seed({ workspace_id: WS, spreadsheet_id: "other", sheet_name: "t", row_count: MAX_ROWS_PER_WORKSPACE });
    await expect(run(prepared(SHOPEE_TABLE, "Shopee"))).rejects.toThrow(ImportError);
    db.sources.find((s) => s.spreadsheet_id === "other")!.row_count = 0;
    await expect(run(prepared(SHOPEE_TABLE, "Shopee"))).resolves.toMatchObject({ totalRows: 4 });
  });

  it("vượt hạn mức dòng của tài khoản: từ chối 413 và dọn nguồn rỗng vừa tạo", async () => {
    db.seed({ workspace_id: WS, spreadsheet_id: "other", sheet_name: "t", row_count: MAX_ROWS_PER_WORKSPACE - 2 });
    const err = await run(prepared(SHOPEE_TABLE, "Shopee")).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.status).toBe(413);
    expect(db.sources.map((s) => s.spreadsheet_id)).toEqual(["other"]); // nguồn đơn hàng vừa tạo đã bị bỏ
  });

  it("đã đủ số nguồn tối đa thì không tạo thêm", async () => {
    for (let i = 0; i < MAX_SOURCES_PER_WORKSPACE; i++) db.seed({ workspace_id: WS, spreadsheet_id: `g${i}`, sheet_name: "t" });
    const err = await run(prepared(SHOPEE_TABLE, "Shopee")).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.status).toBe(403);
  });

  it("nguồn đã có thì vẫn nhập thêm được dù workspace đã đủ số nguồn", async () => {
    await run(prepared(SHOPEE_TABLE, "Shopee"));
    for (let i = 0; i < MAX_SOURCES_PER_WORKSPACE - 1; i++) db.seed({ workspace_id: WS, spreadsheet_id: `g${i}`, sheet_name: "t" });
    expect(db.sources).toHaveLength(MAX_SOURCES_PER_WORKSPACE);
    await expect(run(prepared(TIKTOK_TABLE, "TikTok Shop"))).resolves.toMatchObject({ created: false, totalRows: 6 });
  });

  it("từ chối khi file chưa đủ thông tin (không có dữ liệu đã chuẩn hoá)", () => {
    const p = { ...prepared(SHOPEE_TABLE, "Shopee"), normalized: null, problems: ["Chưa chọn kênh bán."] };
    expect(() => run(p)).toThrow(/Chưa chọn kênh bán/);
  });

  it("nguồn của workspace khác không bị đụng tới", async () => {
    const other = db.seed({ workspace_id: "ws-2", spreadsheet_id: ORDERS_SPREADSHEET_ID, sheet_name: ORDERS_SHEET_NAME }, [{ [COL.channel]: "Shopee", [COL.orderId]: "A1" }]);
    await run(prepared(SHOPEE_TABLE, "Shopee"));
    expect(stored(other.id)).toHaveLength(1);
    expect(db.sources).toHaveLength(2);
  });
});
