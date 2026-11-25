import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runQuery, type Row } from "@dashboard/chart-engine";
import { prepareImport } from "@/lib/orders/prepare";
import { applyCatalogCosts, catalogMap } from "@/lib/profit/catalog";
import { NOTIFY_CALC, NOTIFY_COLUMNS, enrichOrderRows } from "@/lib/profit/notify-metrics";
import { buildOrders, summarize } from "@/lib/profit/order-profit";
import type { MailMessage } from "@/lib/server/mail";
import { processRule, type AlertCtx, type AlertDeps, type AlertLog, type RuleRow, type ScopeRef } from "@/lib/server/alerts/evaluate";
import { checkRule } from "@/lib/server/alerts/validate";

/** Cảnh báo theo cửa hàng (không gắn dashboard) chạy trên bảng đơn hàng đã kèm cột lãi, qua đúng bộ máy cảnh báo của dashboard. */
const SRC = "src-orders";
async function data() {
  const n = "MO-PHONG_Shopee_Order.all.20261101_20261115.xlsx";
  const p = await prepareImport(new Uint8Array(readFileSync(fileURLToPath(new URL(`../../orders/sample-files/${n}`, import.meta.url)))), n, {});
  const rows = applyCatalogCosts(p.normalized!.rows, catalogMap([["AO-001", 62000], ["BGN-002", 90000], ["TOTE-003", 50000], ["SRM-004", 76000], ["KCN-005", 118000], ["CHAO-006", 160000], ["DEN-007", 139000], ["KHAN-008", 41000]].map(([sku, unitCost]) => ({ sku: sku as string, unitCost: unitCost as number })))).rows;
  const orders = buildOrders(rows);
  return { enriched: enrichOrderRows(rows, orders), summary: summarize(orders) };
}

const rule = (metric: Record<string, unknown>, condition: unknown): RuleRow => ({
  id: "r1", dashboard_id: null, workspace_id: "ws1", created_by: "u1", name: "Lãi thấp", condition,
  metric: { sourceId: SRC, filters: [], window: "all", ...metric },
  recipients: ["an@example.com"], cooldown_minutes: 360, notify_recover: false, enabled: true, snooze_until: null,
  last_state: "ok", last_value: null, last_triggered_at: null, last_error: null, group_state: {},
});

async function run(r: RuleRow) {
  const d = await data();
  const mails: MailMessage[] = [];
  const logs: AlertLog[] = [];
  const saves: Record<string, unknown>[] = [];
  const scopes: ScopeRef[] = [];
  let viewTokenCalls = 0;
  const ctx: AlertCtx = {
    dashboardName: "Tiệm Hoa Nắng", openUrl: "https://cerno.cloud/overview", ownerId: "owner",
    sources: [{ id: SRC, columns: NOTIFY_COLUMNS }], calc: NOTIFY_CALC.map((c) => ({ name: c.name, sourceId: SRC })),
    calcDefs: () => NOTIFY_CALC, exec: async (_id, spec) => runQuery(d.enriched, spec),
  };
  const deps: AlertDeps = {
    now: () => new Date("2026-11-16T03:00:00Z"),
    rulesForSource: async () => [], staleRules: async () => [],
    context: async (s) => { scopes.push(s); return ctx; },
    exec: async () => { throw new Error("không được dùng exec chung cho luật theo cửa hàng"); },
    dataChangedAt: async () => null, isOptedOut: async () => false,
    send: async (m) => { mails.push(m); return { ok: true }; },
    mailAllowed: async (s) => { scopes.push(s); return true; },
    log: async (e) => { logs.push(e); },
    save: async (_id, patch) => { saves.push(patch as Record<string, unknown>); },
    creatorEmail: async () => "chu@example.com",
    viewToken: async () => { viewTokenCalls++; return "T"; },
    links: () => ({ pageUrl: "https://cerno.cloud/unsubscribe?t=a", apiUrl: "https://cerno.cloud/api/unsubscribe?t=a", snoozeUrl: "https://cerno.cloud/unsubscribe?t=s", muteUrl: "https://cerno.cloud/unsubscribe?t=m" }),
    origin: "https://cerno.cloud",
  };
  const out = await processRule(r, deps);
  return { out, mails, logs, saves, scopes, viewTokenCalls, summary: d.summary };
}

describe("cảnh báo theo cửa hàng", () => {
  it("chỉ số Lãi vượt ngưỡng → gửi email: dùng exec của cửa hàng, link Tổng quan, chữ 'Cerno', log theo workspace", async () => {
    const r = await run(rule({ metric: { column: "Lãi", aggregation: "sum" } }, { type: "threshold", op: "lt", value: 1e12 }));
    expect(r.out).toMatchObject({ state: "firing", notify: "fire", sent: 1 });
    expect(r.mails).toHaveLength(1);
    expect(r.mails[0].html).toContain("https://cerno.cloud/overview");
    expect(r.mails[0].html).toContain("Mở Cerno");
    expect(r.mails[0].html + r.mails[0].text).not.toMatch(/dashboard/i);
    expect(r.viewTokenCalls).toBe(0);
    expect(r.logs[0]).toMatchObject({ kind: "alert", dashboard_id: null, workspace_id: "ws1", status: "sent" });
    expect(r.scopes).toContainEqual({ dashboardId: null, workspaceId: "ws1" });
    expect(r.saves.at(-1)).toMatchObject({ last_state: "firing", last_value: r.summary.profit });
  });

  it("dùng được trường tổng hợp dựng sẵn (Tỷ lệ hủy %) và không báo khi chưa vượt", async () => {
    const d = await data();
    const rate = (d.summary.cancelled / d.summary.orders) * 100;
    const hit = await run(rule({ metric: { column: "Tỷ lệ hủy (%)" } }, { type: "threshold", op: "gt", value: Math.floor(rate) }));
    expect(hit.out).toMatchObject({ state: "firing", sent: 1 });
    expect(hit.saves.at(-1)).toMatchObject({ last_value: expect.closeTo(rate, 6) });
    const miss = await run(rule({ metric: { column: "Tỷ lệ hủy (%)" } }, { type: "threshold", op: "gt", value: Math.ceil(rate) + 1 }));
    expect(miss.out).toMatchObject({ state: "ok", sent: 0 });
    expect(miss.mails).toHaveLength(0);
  });

  it("theo từng kênh: nêu kênh vi phạm", async () => {
    const r = await run(rule({ metric: { column: "Lãi", aggregation: "sum" }, groupBy: "Kênh" }, { type: "per_group", inner: { type: "threshold", op: "gt", value: 0 } }));
    expect(r.out).toMatchObject({ state: "firing", sent: 1 });
    expect(r.mails[0].text).toContain("Shopee");
  });

  it("kiểm cột: cột ảo và trường dựng sẵn hợp lệ, cột lạ bị từ chối", () => {
    const sources = [{ id: SRC, columns: NOTIFY_COLUMNS }];
    const calc = NOTIFY_CALC.map((c) => ({ name: c.name, sourceId: SRC }));
    const cond = { type: "threshold", op: "lt", value: 1 } as const;
    const m = (metric: { column: string; aggregation?: "sum" }, extra = {}) => ({ metric: { sourceId: SRC, metric, filters: [], window: "today" as const, dateColumn: "Ngày đặt", ...extra }, condition: cond });
    expect(checkRule(m({ column: "Lãi", aggregation: "sum" }), sources, calc)).toEqual([]);
    expect(checkRule(m({ column: "Biên lãi (%)" }), sources, calc)).toEqual([]);
    expect(checkRule(m({ column: "Không có cột này", aggregation: "sum" }), sources, calc)).not.toEqual([]);
    expect(checkRule(m({ column: "Lãi", aggregation: "sum" }, { dateColumn: "Kênh" }), sources, calc)).not.toEqual([]);
  });
});
