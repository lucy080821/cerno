import { describe, expect, it } from "vitest";
import { applyTemplate, rewriteFormula, scanFormula, TemplateError, validateTemplate } from "./apply-template";
import { Dashboard, type DataSource } from "./dashboard";
import { Template } from "./template";

const box = { x: 0, y: 0, w: 300, h: 200 };

function makeTemplate(overrides: Partial<Record<string, unknown>> = {}): Template {
  return Template.parse({
    id: "ban-hang",
    version: 3,
    industry: "Bán hàng",
    name: "Bán hàng",
    description: "Mẫu thử",
    slots: [
      { key: "ngay", label: "Ngày", type: "date", required: true, synonyms: [] },
      { key: "doanh_thu", label: "Doanh thu", type: "number", required: true, synonyms: [] },
      { key: "tinh", label: "Tỉnh", type: "string", required: true, synonyms: [] },
      { key: "chi_phi", label: "Chi phí", type: "number", required: false, synonyms: [] },
    ],
    doc: {
      schemaVersion: 1, id: "tpl", name: "Bán hàng",
      canvas: { width: 1440, height: 900, background: "#fff" },
      sources: [{ id: "tplsrc", type: "sample", name: "Mẫu", columns: [{ name: "ngay", type: "date" }] }],
      pages: [{ id: "p1", name: "Tổng quan" }, { id: "p2", name: "Chi tiết" }],
      calculatedFields: [
        { id: "cf1", sourceId: "tplsrc", name: "Lợi nhuận", expression: '[doanh_thu] - [chi_phi]' },
        { id: "cf2", sourceId: "tplsrc", name: "Cờ", expression: 'IF([tinh] = "[doanh_thu] ngày", 1, 0)' },
        { id: "cf3", sourceId: "tplsrc", name: "Biên", expression: "SUM([Lợi nhuận]) / SUM([doanh_thu])" },
      ],
      filters: [
        { id: "f1", sourceId: "tplsrc", column: "tinh", control: "dropdown", targets: ["w-kpi", "w-bar"] },
        { id: "f2", sourceId: "tplsrc", column: "chi_phi", control: "slider" },
        { id: "f3", sourceId: "tplsrc", column: "tinh", control: "dropdown", targets: ["w-cost"] },
      ],
      widgets: [
        {
          id: "w-kpi", ...box, groupId: "g1", pageId: "p1",
          config: {
            kind: "kpi", sourceId: "tplsrc", metric: { column: "doanh_thu", aggregation: "sum" },
            compare: { to: "prev_period", dateColumn: "ngay", grain: "month", show: "percent", goodWhen: "up", toDate: true },
          },
        },
        {
          id: "w-bar", ...box, groupId: "g1", pageId: "p1",
          config: {
            kind: "chart", chartType: "bar", sourceId: "tplsrc",
            dimensions: [{ column: "tinh" }, { column: "ngay", grain: "month" }],
            metrics: [{ column: "doanh_thu", aggregation: "sum" }, { column: "", aggregation: "count" }],
          },
        },
        {
          id: "w-cost", ...box, pageId: "p2",
          config: { kind: "chart", chartType: "line", sourceId: "tplsrc", dimensions: [{ column: "ngay" }], metrics: [{ column: "chi_phi", aggregation: "sum" }] },
        },
        {
          id: "w-profit", ...box, pageId: "p2",
          config: { kind: "chart", chartType: "bar", sourceId: "tplsrc", dimensions: [{ column: "tinh" }], metrics: [{ column: "Lợi nhuận", aggregation: "sum" }] },
        },
        { id: "w-text", ...box, config: { kind: "text", text: "doanh_thu", fontSize: 16, bold: false, align: "left" } },
      ],
      ...(overrides.doc as object),
    },
    sampleRows: [{ ngay: "2025-01-01", doanh_thu: 100, tinh: "Hà Nội", chi_phi: 40 }],
    ...overrides,
  });
}

const source: DataSource = {
  id: "src-real",
  type: "google_sheets",
  spreadsheetId: "sheet123",
  sheetName: "Data",
  columns: [
    { name: "Ngày HĐ", type: "date" },
    { name: "DT sau CK", type: "number" },
    { name: "Tỉnh", type: "string" },
    { name: "Giá vốn", type: "number" },
    { name: "Lợi nhuận", type: "number" },
  ],
};

const FULL = { ngay: "Ngày HĐ", doanh_thu: "DT sau CK", tinh: "Tỉnh", chi_phi: "Giá vốn" };

function seqIds() {
  let n = 0;
  return () => `id${++n}`;
}

/** Mọi chuỗi trong cây JSON. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

describe("scanFormula / rewriteFormula", () => {
  it("tìm tham chiếu [cột], bỏ qua chuỗi chữ và số", () => {
    const { refs, bare } = scanFormula('IF([a b] > 1e5, "[x]", \'[y]\\\'[z]\') + [c]');
    expect(refs.map((r) => r.name)).toEqual(["a b", "c"]);
    expect(bare).toEqual([]);
  });

  it("phát hiện tên trần nhưng cho phép hàm và TRUE/FALSE/NULL/AND/OR/NOT", () => {
    expect(scanFormula("doanh_thu + 1").bare).toEqual(["doanh_thu"]);
    expect(scanFormula("IF(TRUE AND NOT FALSE OR NULL, SUM ([a]), 0)").bare).toEqual([]);
  });

  it("rewrite giữ nguyên phần còn lại", () => {
    const out = rewriteFormula('IF([tinh] = "[tinh]", [  doanh_thu ], 0)', (n) => ({ tinh: "Tỉnh", doanh_thu: "DT" })[n] ?? n);
    expect(out).toBe('IF([Tỉnh] = "[tinh]", [DT], 0)');
  });

  it("từ chối tên cột chứa ]", () => {
    expect(() => rewriteFormula("[a]", () => "x]y")).toThrow(TemplateError);
  });
});

describe("validateTemplate", () => {
  it("mẫu thử hợp lệ", () => {
    expect(validateTemplate(makeTemplate())).toEqual([]);
  });

  it("bắt công thức dùng tên trần, cột lạ, echartsOverride, nhiều nguồn, khoá vai trùng", () => {
    const t = makeTemplate();
    t.doc.calculatedFields[0].expression = "doanh_thu - 1";
    t.doc.calculatedFields[1].expression = "[khong_co]";
    expect(validateTemplate(t).join("|")).toMatch(/tên trần "doanh_thu"/);
    expect(validateTemplate(t).join("|")).toMatch(/cột lạ \[khong_co\]/);

    const t2 = makeTemplate();
    const w = t2.doc.widgets[1].config;
    if (w.kind === "chart") w.echartsOverride = { a: 1 };
    expect(validateTemplate(t2).join("|")).toMatch(/echartsOverride/);

    const t3 = makeTemplate();
    t3.doc.sources.push({ id: "x", type: "sample", name: "x", columns: [] });
    expect(validateTemplate(t3).join("|")).toMatch(/đúng 1 nguồn/);

    const t4 = makeTemplate();
    t4.slots.push({ ...t4.slots[0] });
    expect(validateTemplate(t4).join("|")).toMatch(/Khoá vai trùng/);

    const t5 = makeTemplate();
    t5.doc.widgets[0].config.kind === "kpi" && (t5.doc.widgets[0].config.metric.column = "lạ");
    expect(validateTemplate(t5).join("|")).toMatch(/cột lạ "lạ"/);
  });

  it("applyTemplate từ chối mẫu sai quy ước", () => {
    const t = makeTemplate();
    t.doc.calculatedFields[0].expression = "doanh_thu";
    expect(() => applyTemplate(t, FULL, source)).toThrow(TemplateError);
  });
});

describe("applyTemplate: đủ vai", () => {
  const t = makeTemplate();
  const { doc, dropped } = applyTemplate(t, FULL, source, { newId: seqIds() });
  const realCols = new Set(source.columns.map((c) => c.name));

  it("kết quả là Dashboard hợp lệ, giữ cả 5 widget, không bỏ gì", () => {
    expect(Dashboard.safeParse(doc).success).toBe(true);
    expect(doc.widgets).toHaveLength(5);
    expect(dropped).toEqual({ widgets: [], filters: [], calculatedFields: [] });
  });

  it("gán nguồn thật, id mới, meta mẫu", () => {
    expect(doc.sources).toEqual([source]);
    expect(doc.id).not.toBe("tpl");
    expect(doc.meta).toEqual({ templateId: "ban-hang", templateVersion: 3 });
    for (const w of doc.widgets) {
      if (w.config.kind === "chart" || w.config.kind === "kpi") expect(w.config.sourceId).toBe("src-real");
    }
    const ids = [doc.id, ...doc.widgets.map((w) => w.id), ...doc.filters.map((f) => f.id), ...doc.calculatedFields.map((f) => f.id), ...doc.pages.map((p) => p.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((i) => ["tpl", "w-kpi", "f1", "cf1", "p1"].includes(i))).toBe(false);
  });

  it("đổi cột ở FieldBinding, KPI compare, filter, công thức", () => {
    const [kpi, bar] = doc.widgets;
    if (kpi.config.kind !== "kpi" || bar.config.kind !== "chart") throw new Error("sai loại");
    expect(kpi.config.metric.column).toBe("DT sau CK");
    expect(kpi.config.compare?.dateColumn).toBe("Ngày HĐ");
    expect(bar.config.dimensions.map((d) => d.column)).toEqual(["Tỉnh", "Ngày HĐ"]);
    expect(bar.config.dimensions[1].grain).toBe("month");
    expect(bar.config.metrics.map((m) => m.column)).toEqual(["DT sau CK", ""]);
    expect(doc.filters.map((f) => f.column)).toEqual(["Tỉnh", "Giá vốn", "Tỉnh"]);
  });

  it("trường tính toán trùng tên cột thật được đổi tên và widget/công thức theo", () => {
    const names = doc.calculatedFields.map((f) => f.name);
    expect(names[0]).toBe("Lợi nhuận (tính toán)");
    expect(doc.calculatedFields[0].expression).toBe("[DT sau CK] - [Giá vốn]");
    expect(doc.calculatedFields[2].expression).toBe("SUM([Lợi nhuận (tính toán)]) / SUM([DT sau CK])");
    const profit = doc.widgets[3].config;
    if (profit.kind !== "chart") throw new Error("sai loại");
    expect(profit.metrics[0].column).toBe("Lợi nhuận (tính toán)");
  });

  it("chuỗi chữ trong công thức và widget văn bản không bị đổi", () => {
    expect(doc.calculatedFields[1].expression).toBe('IF([Tỉnh] = "[doanh_thu] ngày", 1, 0)');
    const text = doc.widgets[4].config;
    expect(text.kind === "text" && text.text).toBe("doanh_thu");
  });

  it("nối lại targets, groupId, trang theo id mới", () => {
    const [kpi, bar, cost] = doc.widgets;
    expect(doc.filters[0].targets).toEqual([kpi.id, bar.id]);
    expect(doc.filters[2].targets).toEqual([cost.id]);
    expect(kpi.groupId).toBeDefined();
    expect(kpi.groupId).toBe(bar.groupId);
    expect(kpi.groupId).not.toBe("g1");
    expect(kpi.pageId).toBe(doc.pages[0].id);
    expect(cost.pageId).toBe(doc.pages[1].id);
    expect(doc.widgets[4].pageId).toBeUndefined();
  });

  it("không sót khoá vai: mọi tham chiếu cột là cột thật hoặc trường tính toán", () => {
    const calcNames = new Set(doc.calculatedFields.map((f) => f.name));
    const ok = (n: string) => n === "" || realCols.has(n) || calcNames.has(n);
    for (const w of doc.widgets) {
      const c = w.config;
      const cols = c.kind === "chart" ? [...c.dimensions, ...c.metrics].map((b) => b.column) : c.kind === "kpi" ? [c.metric.column, c.compare?.dateColumn ?? ""] : [];
      for (const n of cols) expect(ok(n), `${w.id}: ${n}`).toBe(true);
    }
    for (const f of doc.filters) expect(ok(f.column)).toBe(true);
    for (const f of doc.calculatedFields) {
      const { refs, bare } = scanFormula(f.expression);
      expect(bare).toEqual([]);
      for (const r of refs) expect(ok(r.name), f.expression).toBe(true);
    }
    // Quét thô: không chuỗi nào ngoài widget văn bản và chuỗi trong công thức trùng đúng một khoá vai.
    const keys = new Set(t.slots.map((s) => s.key));
    const copy = JSON.parse(JSON.stringify(doc));
    copy.widgets = copy.widgets.filter((w: { config: { kind: string } }) => w.config.kind !== "text");
    copy.calculatedFields = [];
    for (const s of strings(copy)) expect(keys.has(s), s).toBe(false);
  });
});

describe("applyTemplate: vai tuỳ chọn trống", () => {
  const t = makeTemplate();
  for (const empty of [undefined, null, ""] as const) {
    it(`bỏ widget, trường tính toán, bộ lọc dùng vai trống (chi_phi = ${JSON.stringify(empty)})`, () => {
      const { doc, dropped } = applyTemplate(t, { ...FULL, chi_phi: empty }, source, { newId: seqIds() });
      expect(dropped.widgets.sort()).toEqual(["w-cost", "w-profit"]);
      // Lợi nhuận dùng chi_phi → bỏ; Biên dùng Lợi nhuận → bỏ theo (lan truyền); Cờ giữ.
      expect(dropped.calculatedFields.sort()).toEqual(["Biên", "Lợi nhuận"]);
      expect(doc.calculatedFields.map((f) => f.name)).toEqual(["Cờ"]);
      // f2 dùng chi_phi → bỏ; f3 chỉ nhắm w-cost (đã bỏ) → bỏ.
      expect(dropped.filters.sort()).toEqual(["f2", "f3"]);
      expect(doc.filters).toHaveLength(1);
      expect(doc.widgets.map((w) => w.config.kind)).toEqual(["kpi", "chart", "text"]);
      expect(Dashboard.safeParse(doc).success).toBe(true);
    });
  }

  it("Cờ không còn trùng tên thì giữ nguyên tên", () => {
    const { doc } = applyTemplate(t, { ...FULL, chi_phi: null }, source);
    expect(doc.calculatedFields[0].name).toBe("Cờ");
  });
});

describe("applyTemplate: lỗi đầu vào", () => {
  const t = makeTemplate();
  it("thiếu vai bắt buộc", () => {
    expect(() => applyTemplate(t, { ...FULL, doanh_thu: null }, source)).toThrow(/Doanh thu/);
  });
  it("cột không có trong nguồn", () => {
    expect(() => applyTemplate(t, { ...FULL, tinh: "Không tồn tại" }, source)).toThrow(/không có trong nguồn/);
  });
  it("cột có ] bị từ chối khi nằm trong công thức", () => {
    const src: DataSource = { ...source, columns: [...source.columns, { name: "Giá]vốn", type: "number" }] };
    expect(() => applyTemplate(t, { ...FULL, chi_phi: "Giá]vốn" }, src)).toThrow(TemplateError);
  });
  it("hai lần áp cho hai kết quả độc lập (không dùng chung id)", () => {
    const a = applyTemplate(t, FULL, source).doc;
    const b = applyTemplate(t, FULL, source).doc;
    expect(a.id).not.toBe(b.id);
    expect(a.widgets[0].id).not.toBe(b.widgets[0].id);
  });
  it("không làm đổi mẫu gốc", () => {
    const snap = JSON.stringify(t);
    applyTemplate(t, { ...FULL, chi_phi: null }, source);
    expect(JSON.stringify(t)).toBe(snap);
  });
});

describe("tên trường tính toán trùng nhau sau đổi tên", () => {
  it("thêm hậu tố tăng dần khi cả 'X' và 'X (tính toán)' đã có", () => {
    const t = makeTemplate();
    const src: DataSource = {
      ...source,
      columns: [...source.columns, { name: "Lợi nhuận (tính toán)", type: "number" }],
    };
    const { doc } = applyTemplate(t, FULL, src);
    expect(doc.calculatedFields[0].name).toBe("Lợi nhuận (tính toán 2)");
  });
});
