import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Row } from "@dashboard/chart-engine";

const { alerts, invalidate } = vi.hoisted(() => ({ alerts: vi.fn(async (_id: string) => undefined), invalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/alerts/after-change", () => ({ evaluateAlertsAfterChange: alerts }));
vi.mock("@/lib/server/row-cache", () => ({ invalidateSourceCache: invalidate }));

import { COL, ORDERS_SHEET_NAME, ORDERS_SPREADSHEET_ID } from "./canonical";
import { FakeDb } from "./fake-db";
import { ImportError, importOrders } from "./import";
import { connectOrderSheet, inspectOrderSheet, syncDueOrderSheets, syncOrderSheet, type SheetDeps } from "./sheet-sync";
import { detectSheet } from "./detect";
import { normalizeOrders } from "./normalize";
import { SHOPEE_TABLE } from "./fixtures";
import type { Prepared } from "./prepare";

const WS = "ws-1";
const HEADER = ["Mã đơn hàng", "Trạng thái đơn hàng", "Ngày đặt hàng", "Tên sản phẩm", "SKU phân loại hàng", "Số lượng", "Tổng giá bán (sản phẩm)"];
const line = (id: string, status = "Hoàn thành", date = "05/09/2025", product = "Áo", sku = "A1", qty = "1", total = "100.000") => [id, status, date, product, sku, qty, total];

let db: FakeDb;
let current: string[][];
let read: ReturnType<typeof vi.fn>;
let deps: SheetDeps;
const canonical = () => db.sources.find((s) => s.spreadsheet_id === ORDERS_SPREADSHEET_ID);
const stored = (): Row[] => (canonical() ? ((db.rows.get(canonical()!.id) ?? []) as Row[]) : []);
const ids = (channel: string) => [...new Set(stored().filter((r) => r[COL.channel] === channel).map((r) => r[COL.orderId]))].sort();
const sheetRow = () => db.tables.order_sheets?.[0];

const connect = (over: Partial<Parameters<typeof connectOrderSheet>[0]> = {}) =>
  connectOrderSheet({ user: db.client(), userId: "u1", workspaceId: WS, token: "tok", spreadsheetId: "SHEETID1234567", sheetName: "Shopee", name: "Đơn Shopee", channel: "Shopee", mapping: undefined, ...over }, deps);

beforeEach(() => {
  db = new FakeDb();
  current = [HEADER, line("A1"), line("A2", "Hoàn thành", "06/09/2025")];
  read = vi.fn(async () => current);
  deps = { admin: db.client(), read: read as unknown as SheetDeps["read"], token: async () => "tok" };
  alerts.mockClear();
  invalidate.mockClear();
});

describe("nối Google Sheet đơn hàng", () => {
  it("nối tab: tạo bản ghi (ánh xạ theo TÊN cột), tạo nguồn đơn hàng và ghi các đơn của kênh", async () => {
    const r = await connect();
    expect(r.lines).toBe(2);
    expect(r.orders).toBe(2);
    expect(sheetRow()).toMatchObject({ channel: "Shopee", spreadsheet_id: "SHEETID1234567", sheet_name: "Shopee", line_count: 2, order_count: 2, last_error: null });
    expect(sheetRow().mapping.orderId).toEqual(["Mã đơn hàng"]);
    expect(canonical()?.row_count).toBe(2);
    expect(ids("Shopee")).toEqual(["A1", "A2"]);
    expect(alerts).toHaveBeenCalled();
  });

  it("thay dữ liệu cũ của CÙNG kênh (kể cả đơn đã tải bằng file), kênh khác giữ nguyên", async () => {
    const seeded = db.seed({ workspace_id: WS, spreadsheet_id: ORDERS_SPREADSHEET_ID, sheet_name: ORDERS_SHEET_NAME, name: "Đơn hàng đa kênh" }, [
      { [COL.channel]: "Shopee", [COL.orderId]: "OLD", [COL.orders]: 1 },
      { [COL.channel]: "TikTok Shop", [COL.orderId]: "TT1", [COL.orders]: 1 },
    ]);
    await connect();
    expect(ids("Shopee")).toEqual(["A1", "A2"]);
    expect(ids("TikTok Shop")).toEqual(["TT1"]);
    expect(db.rows.get(seeded.id)).toHaveLength(3);
  });

  it("áp giá vốn đã lưu cho đơn từ Sheet", async () => {
    db.costs.push({ workspace_id: WS, sku: "A1", unit_cost: 30_000 });
    await connect();
    expect(stored().find((r) => r[COL.orderId] === "A1")?.[COL.cost]).toBe(30_000);
  });

  it("mỗi kênh chỉ nối một Sheet; cùng tab không nối hai lần", async () => {
    await connect();
    await expect(connect({ spreadsheetId: "OTHERSHEET123456" })).rejects.toThrow(/đã nối với Sheet/);
    await expect(connect({ channel: "TikTok Shop" })).rejects.toThrow(/đã được nối cho kênh Shopee/);
    expect(db.tables.order_sheets).toHaveLength(1);
  });

  it("lần đồng bộ đầu lỗi thì bỏ bản ghi vừa tạo", async () => {
    current = [HEADER, line("5.78E+17")];
    await expect(connect()).rejects.toThrow(/số khoa học/);
    expect(db.tables.order_sheets ?? []).toHaveLength(0);
    expect(canonical()).toBeUndefined();
  });

  it("xem trước không ghi gì", async () => {
    const r = await inspectOrderSheet({ token: "tok", spreadsheetId: "SHEETID1234567", sheetName: "Shopee", channel: "Shopee" }, deps);
    expect(r.prepared.problems).toEqual([]);
    expect(r.prepared.normalized?.stats.orders).toBe(2);
    expect(db.tables.order_sheets ?? []).toHaveLength(0);
    expect(db.sources).toHaveLength(0);
  });
});

describe("đồng bộ lại Sheet đơn hàng", () => {
  it("Sheet là bản đúng: thêm dòng bên dưới, dán chồng khoảng ngày thì không nhân đôi, trạng thái mới thắng", async () => {
    await connect();
    current = [HEADER, line("A1"), line("A2", "Hoàn thành", "06/09/2025"), line("A3", "Hoàn thành", "07/09/2025"), line("A2", "Hoàn trả", "06/09/2025")];
    const r = await syncOrderSheet(sheetRow().id, "u1", undefined, deps);
    expect(r.changed).toBe(true);
    expect(ids("Shopee")).toEqual(["A1", "A2", "A3"]);
    expect(stored().find((x) => x[COL.orderId] === "A2")?.[COL.status]).toBe("Hoàn trả");
    expect(stored()).toHaveLength(3);
    expect(sheetRow().warnings.join(" ")).toMatch(/dòng trùng/);
  });

  it("xoá dòng trong Sheet thì đơn đó biến mất khỏi số liệu", async () => {
    await connect();
    current = [HEADER, line("A1")];
    await syncOrderSheet(sheetRow().id, "u1", undefined, deps);
    expect(ids("Shopee")).toEqual(["A1"]);
  });

  it("Sheet không đổi thì chỉ ghi giờ cập nhật, không ghi lại dữ liệu", async () => {
    await connect();
    invalidate.mockClear();
    const r = await syncOrderSheet(sheetRow().id, "u1", undefined, deps);
    expect(r.changed).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
    expect(stored()).toHaveLength(2);
  });

  it("chèn thêm cột vào Sheet không làm lệch (ánh xạ theo tên cột)", async () => {
    await connect();
    current = [["Ghi chú", ...HEADER], ["x", ...line("A1")], ["y", ...line("B7", "Hoàn thành", "08/09/2025")]];
    await syncOrderSheet(sheetRow().id, "u1", undefined, deps);
    expect(ids("Shopee")).toEqual(["A1", "B7"]);
  });

  it("lỗi (mất cột, mã đơn hỏng) thì GIỮ NGUYÊN dữ liệu cũ và ghi lỗi để người dùng thấy", async () => {
    await connect();
    current = [HEADER.filter((h) => h !== "Ngày đặt hàng"), ["A1", "Hoàn thành", "Áo", "A1", "1", "100.000"]];
    await expect(syncOrderSheet(sheetRow().id, "u1", undefined, deps)).rejects.toThrow(/Ngày đặt hàng/);
    expect(ids("Shopee")).toEqual(["A1", "A2"]);
    expect(sheetRow().last_error).toMatch(/Ngày đặt hàng/);

    current = [HEADER, line("5.78E+17")];
    await expect(syncOrderSheet(sheetRow().id, "u1", undefined, deps)).rejects.toThrow(/số khoa học/);
    expect(ids("Shopee")).toEqual(["A1", "A2"]);

    // Sửa lại Sheet thì lần sau tự hết lỗi.
    current = [HEADER, line("A1"), line("A2", "Hoàn thành", "06/09/2025"), line("A9")];
    await syncOrderSheet(sheetRow().id, "u1", undefined, deps);
    expect(sheetRow().last_error).toBeNull();
    expect(ids("Shopee")).toEqual(["A1", "A2", "A9"]);
  });

  it("Sheet quá lớn thì báo lỗi rõ", async () => {
    await connect();
    current = Array.from({ length: 150_000 }, () => []);
    await expect(syncOrderSheet(sheetRow().id, "u1", undefined, deps)).rejects.toThrow(/quá nhiều dòng/);
    expect(ids("Shopee")).toEqual(["A1", "A2"]);
  });
});

describe("tải file vào kênh đang nối Sheet", () => {
  const prepared = (channel: "Shopee" | "TikTok Shop"): Prepared => {
    const d = detectSheet(SHOPEE_TABLE)!;
    return { filename: "x.xlsx", sheetNames: ["s"], sheet: "s", headerRow: d.headerRow, headers: d.headers, profile: d.profile, profileLabel: "", channel, mapping: d.mapping, problems: [], normalized: normalizeOrders(SHOPEE_TABLE, d.headerRow, d.mapping, channel) };
  };
  const upload = (channel: "Shopee" | "TikTok Shop") => importOrders({ user: db.client(), admin: db.client(), userId: "u1", workspaceId: WS, prepared: prepared(channel) });

  it("bị chặn với kênh đã nối Sheet (tránh hai nguồn chồng nhau), kênh khác vẫn tải được", async () => {
    await connect();
    await expect(upload("Shopee")).rejects.toMatchObject({ status: 409 });
    await expect(upload("Shopee")).rejects.toBeInstanceOf(ImportError);
    await expect(upload("Shopee")).rejects.toThrow(/Google Sheet "Đơn Shopee"/);
    await upload("TikTok Shop");
    expect(ids("TikTok Shop").length).toBeGreaterThan(0);
    expect(ids("Shopee")).toEqual(["A1", "A2"]); // không bị đụng
  });
});

describe("tự động cập nhật theo lịch", () => {
  it("chỉ cập nhật Sheet đã đến hạn, mỗi người dùng chỉ lấy token một lần", async () => {
    await connect();
    db.tables.order_sheets[0].last_synced_at = new Date(Date.now() - 3 * 3_600_000).toISOString();
    db.tables.order_sheets[0].last_attempt_at = null;
    await connectOrderSheet({ user: db.client(), userId: "u1", workspaceId: WS, token: "tok", spreadsheetId: "SHEETID7654321", sheetName: "TikTok", name: "Đơn TikTok", channel: "TikTok Shop", mapping: undefined }, deps);
    // Sheet thứ hai vừa đồng bộ xong nên chưa đến hạn.
    current = [HEADER, line("A1"), line("A2", "Hoàn thành", "06/09/2025"), line("A5")];
    const tokenSpy = vi.fn(async () => "tok");
    const r = await syncDueOrderSheets({ ...deps, token: tokenSpy });
    expect(r.due).toBe(1);
    expect(r.results[0]).toMatchObject({ ok: true, changed: true });
    expect(tokenSpy).toHaveBeenCalledTimes(1);
  });

  it("lỗi một Sheet không làm hỏng Sheet khác và được ghi lại", async () => {
    await connect();
    db.tables.order_sheets[0].last_synced_at = new Date(Date.now() - 3 * 3_600_000).toISOString();
    db.tables.order_sheets[0].last_attempt_at = null;
    current = [HEADER, line("5.78E+17")];
    const r = await syncDueOrderSheets(deps);
    expect(r.results[0].ok).toBe(false);
    expect(sheetRow().last_error).toMatch(/số khoa học/);
  });
});
