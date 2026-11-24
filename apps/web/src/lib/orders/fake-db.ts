/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Row } from "@dashboard/chart-engine";

/**
 * DB giả trong bộ nhớ, chỉ hiểu đúng các lời gọi Supabase mà dịch vụ nhập file dùng (data_sources, source_rows, RPC
 * source_rows_chunk). Dùng chung cho test dịch vụ nhập và test route. Không phải bản mô phỏng đầy đủ của PostgREST.
 */
export interface SourceRecord {
  id: string;
  workspace_id: string;
  spreadsheet_id: string;
  sheet_name: string;
  name?: string;
  row_count: number;
  columns?: unknown;
  last_sync_hash?: string | null;
  last_error?: string | null;
}

type Cond = { op: "eq" | "neq" | "gte"; col: string; val: any };
interface Q {
  op: "select" | "insert" | "update" | "upsert" | "delete";
  conds: Cond[];
  head: boolean;
  single: false | "maybe" | "one";
  payload?: any;
}

const test = (c: Cond, r: any) => (c.op === "eq" ? r[c.col] === c.val : c.op === "neq" ? r[c.col] !== c.val : r[c.col] >= c.val);

export class FakeDb {
  sources: SourceRecord[] = [];
  rows = new Map<string, Row[]>();
  /** Các bảng khác (order_sheets, ad_spend...): kho chung đơn giản, mỗi bảng một mảng bản ghi. */
  tables: Record<string, any[]> = {};
  /** Bảng giá vốn (product_costs). */
  costs: { workspace_id: string; sku: string; name?: string; unit_cost: number }[] = [];
  /** Thời gian chờ giả lập cho mỗi lời gọi, để các tác vụ đồng thời xen kẽ nhau. */
  delayMs = 0;
  private seq = 0;

  seed(s: Partial<SourceRecord> & { workspace_id: string }, rows: Row[] = []): SourceRecord {
    const rec: SourceRecord = { id: `src-${++this.seq}`, spreadsheet_id: "x", sheet_name: "s", row_count: rows.length, ...s };
    this.sources.push(rec);
    this.rows.set(rec.id, [...rows]);
    return rec;
  }

  private wait() {
    return this.delayMs ? new Promise((r) => setTimeout(r, this.delayMs)) : Promise.resolve();
  }

  /** Client giả dùng được cho cả vai "người dùng" (RLS) lẫn "service role": ở đây không phân biệt quyền. */
  client(): any {
    const make = (table: string) => {
      const q: Q = { op: "select", conds: [], head: false, single: false };
      const run = async () => {
        await this.wait();
        if (table === "product_costs") return { data: this.costs.filter((r) => q.conds.every((c) => test(c, r))), error: null };
        if (table === "data_sources") return this.execSources(q);
        if (table === "source_rows") return this.execRows(q);
        return this.execGeneric(table, q);
      };
      const chain: any = {
        select: (_cols?: string, opts?: { head?: boolean }) => {
          if (opts?.head) q.head = true;
          return chain;
        },
        insert: (p: any) => Object.assign(q, { op: "insert", payload: p }) && chain,
        update: (p: any) => Object.assign(q, { op: "update", payload: p }) && chain,
        upsert: (p: any) => Object.assign(q, { op: "upsert", payload: p }) && chain,
        delete: () => Object.assign(q, { op: "delete" }) && chain,
        order: () => chain,
        limit: () => chain,
        eq: (col: string, val: any) => q.conds.push({ op: "eq", col, val }) && chain,
        neq: (col: string, val: any) => q.conds.push({ op: "neq", col, val }) && chain,
        gte: (col: string, val: any) => q.conds.push({ op: "gte", col, val }) && chain,
        maybeSingle: () => Object.assign(q, { single: "maybe" }) && run(),
        single: () => Object.assign(q, { single: "one" }) && run(),
        then: (res: any, rej: any) => run().then(res, rej),
      };
      return chain;
    };
    return {
      from: make,
      rpc: async (name: string, a: { p_source: string; p_from: number; p_to: number }) => {
        await this.wait();
        if (name !== "source_rows_chunk") throw new Error(`rpc lạ: ${name}`);
        return { data: (this.rows.get(a.p_source) ?? []).slice(a.p_from, a.p_to), error: null };
      },
    };
  }

  private execSources(q: Q) {
    const hit = () => this.sources.filter((r) => q.conds.every((c) => test(c, r)));
    if (q.op === "insert") {
      const p = q.payload;
      if (this.sources.some((s) => s.workspace_id === p.workspace_id && s.spreadsheet_id === p.spreadsheet_id && s.sheet_name === p.sheet_name)) {
        return { data: null, error: { code: "23505", message: "duplicate" } };
      }
      const rec = this.seed({ ...p, row_count: 0 });
      return { data: { id: rec.id, row_count: 0 }, error: null };
    }
    if (q.op === "update") {
      for (const s of hit()) Object.assign(s, q.payload);
      return { data: null, error: null };
    }
    if (q.op === "delete") {
      for (const s of hit()) {
        this.sources.splice(this.sources.indexOf(s), 1);
        this.rows.delete(s.id);
      }
      return { error: null };
    }
    const found = hit();
    if (q.head) return { count: found.length, error: null };
    if (q.single) return { data: found[0] ?? null, error: null };
    return { data: found, error: null };
  }

  /** Giá trị mặc định của cột (DB thật tự điền khi insert). */
  private defaults: Record<string, Record<string, unknown>> = {
    order_sheets: { sync_interval_minutes: 120, last_synced_at: null, last_attempt_at: null, last_sync_hash: null, last_error: null, line_count: 0, order_count: 0, warnings: [] },
  };
  private uniqueKeys: Record<string, string[][]> = {
    order_sheets: [["workspace_id", "channel"], ["workspace_id", "spreadsheet_id", "sheet_name"]],
  };

  private execGeneric(table: string, q: Q) {
    const list = (this.tables[table] ??= []);
    const hit = () => list.filter((r) => q.conds.every((c) => test(c, r)));
    if (q.op === "insert") {
      const p = q.payload;
      for (const cols of this.uniqueKeys[table] ?? []) {
        if (list.some((r) => cols.every((c) => r[c] === p[c]))) return { data: null, error: { code: "23505", message: "duplicate" } };
      }
      const rec = { id: `${table}-${list.length + 1}-${Math.random().toString(36).slice(2, 8)}`, ...this.defaults[table], ...p };
      list.push(rec);
      return { data: rec, error: null };
    }
    if (q.op === "update") {
      for (const r of hit()) Object.assign(r, q.payload);
      return { data: null, error: null };
    }
    if (q.op === "delete") {
      for (const r of hit()) list.splice(list.indexOf(r), 1);
      return { error: null };
    }
    if (q.op !== "select") return { data: null, error: { code: "0", message: `thao tác lạ trên ${table}: ${q.op}` } };
    const found = hit();
    if (q.head) return { count: found.length, error: null };
    if (q.single) return { data: found[0] ?? null, error: null };
    return { data: found, error: null };
  }

  private execRows(q: Q) {
    if (q.op === "upsert") {
      for (const r of q.payload as { source_id: string; row_index: number; data: Row }[]) {
        const list = this.rows.get(r.source_id) ?? [];
        list[r.row_index] = r.data;
        this.rows.set(r.source_id, list);
      }
      return { error: null };
    }
    if (q.op === "delete") {
      // Chỉ hỗ trợ dạng "bỏ phần dôi ở cuối": source_id = X và row_index >= n.
      const id = q.conds.find((c) => c.op === "eq" && c.col === "source_id")?.val;
      const from = q.conds.find((c) => c.op === "gte" && c.col === "row_index")?.val;
      const list = this.rows.get(id);
      if (list && typeof from === "number") list.length = Math.min(list.length, from);
      return { error: null };
    }
    throw new Error(`thao tác lạ trên source_rows: ${q.op}`);
  }
}
