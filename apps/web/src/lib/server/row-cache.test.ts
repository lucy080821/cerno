import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Giả lập DB: một nguồn có `rowCount` dòng {i}, phiên bản `version`; đếm số lần gọi RPC.
const db = {
  sources: {} as Record<string, { rowCount: number; version: string }>,
  rpcCalls: 0,
  /** Chạy trước khi trả dữ liệu của mỗi lần RPC (để mô phỏng nguồn đổi giữa lúc đang nạp). */
  onRpc: null as null | (() => void),
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            const s = db.sources[id];
            return {
              data: s ? { workspace_id: "ws", row_count: s.rowCount, last_sync_hash: s.version, last_synced_at: null } : null,
            };
          },
        }),
      }),
    }),
    rpc: async (_name: string, a: { p_source: string; p_from: number; p_to: number }) => {
      db.rpcCalls++;
      db.onRpc?.();
      const total = db.sources[a.p_source].rowCount;
      const out = [];
      for (let i = a.p_from; i < Math.min(a.p_to, total); i++) out.push({ i });
      return { data: out, error: null };
    },
  }),
}));

const load = async () => {
  vi.resetModules();
  return import("./row-cache");
};

beforeEach(() => {
  db.sources = { a: { rowCount: 25_000, version: "v1" }, b: { rowCount: 25_000, version: "v1" } };
  db.rpcCalls = 0;
  db.onRpc = null;
  delete process.env.ROW_CACHE_MAX_ROWS;
});

describe("row-cache", () => {
  it("nạp đủ dòng theo đúng thứ tự qua nhiều đoạn", async () => {
    const c = await load();
    const meta = (await c.getSourceMeta("a"))!;
    const rows = await c.getSourceRows("a", meta);
    expect(rows).toHaveLength(25_000);
    expect(rows.every((r, i) => r.i === i)).toBe(true);
    expect(db.rpcCalls).toBe(3); // 10.000 + 10.000 + 5.000
  });

  it("lần sau cùng phiên bản không gọi DB nữa", async () => {
    const c = await load();
    const meta = (await c.getSourceMeta("a"))!;
    const first = await c.getSourceRows("a", meta);
    const calls = db.rpcCalls;
    expect(await c.getSourceRows("a", meta)).toBe(first);
    expect(db.rpcCalls).toBe(calls);
  });

  it("nhiều yêu cầu đồng thời chỉ nạp một lần", async () => {
    const c = await load();
    const meta = (await c.getSourceMeta("a"))!;
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => c.getSourceRows("a", meta)));
    expect(new Set(all).size).toBe(1);
    expect(db.rpcCalls).toBe(3);
  });

  it("phiên bản đổi (đồng bộ ra dữ liệu mới) thì nạp lại", async () => {
    const c = await load();
    const m1 = (await c.getSourceMeta("a"))!;
    await c.getSourceRows("a", m1);
    db.sources.a = { rowCount: 12_000, version: "v2" };
    c.invalidateSourceCache("a");
    const m2 = (await c.getSourceMeta("a"))!;
    expect(m2.version).toBe("v2");
    const rows = await c.getSourceRows("a", m2);
    expect(rows).toHaveLength(12_000);
  });

  it("nguồn đổi giữa lúc đang nạp thì không giữ bản nạp dở", async () => {
    const c = await load();
    const meta = (await c.getSourceMeta("a"))!;
    db.onRpc = () => { db.sources.a.version = "v2"; };
    await c.getSourceRows("a", meta);
    db.onRpc = null;
    const calls = db.rpcCalls;
    // Bản v1 không được nhớ: hỏi lại với phiên bản mới phải nạp lại.
    const m2 = (await c.getSourceMeta("a", true))!;
    await c.getSourceRows("a", m2);
    expect(db.rpcCalls).toBeGreaterThan(calls);
  });

  it("vượt giới hạn bộ nhớ thì bỏ nguồn ít dùng nhất, giữ nguồn vừa nạp", async () => {
    process.env.ROW_CACHE_MAX_ROWS = "30000";
    const c = await load();
    const ma = (await c.getSourceMeta("a"))!;
    const mb = (await c.getSourceMeta("b"))!;
    await c.getSourceRows("a", ma);
    await c.getSourceRows("b", mb); // tổng 50.000 > 30.000: bỏ a
    let calls = db.rpcCalls;
    await c.getSourceRows("b", mb);
    expect(db.rpcCalls).toBe(calls); // b còn
    calls = db.rpcCalls;
    await c.getSourceRows("a", ma);
    expect(db.rpcCalls).toBeGreaterThan(calls); // a phải nạp lại
  });

  it("nguồn không tồn tại trả null", async () => {
    const c = await load();
    expect(await c.getSourceMeta("zzz")).toBeNull();
  });
});

describe("query-service", () => {
  it("nhớ kết quả theo (nguồn, phiên bản, truy vấn)", async () => {
    vi.resetModules();
    const { getSourceMeta } = await import("./row-cache");
    const { executeQuery } = await import("./query-service");
    const meta = (await getSourceMeta("a"))!;
    const spec = { mode: "aggregate" as const, dims: [], metrics: [{ column: "i", aggregation: "sum" as const }], filters: [], calc: [] };
    const r1 = await executeQuery("a", meta, spec);
    const calls = db.rpcCalls;
    const r2 = await executeQuery("a", meta, spec);
    expect(r2).toBe(r1);
    expect(db.rpcCalls).toBe(calls);
    expect(r1.mode === "aggregate" && r1.table.rows[0].values[0]).toBe((25_000 * 24_999) / 2);
  });
});
