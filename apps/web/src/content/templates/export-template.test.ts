import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyTemplate, scanFormula as schemaScan, Slot, Template, validateTemplate, type DataSource, type Dashboard,
} from "@dashboard/schema";
import { buildTemplate, normalizeText, scanFormula } from "../../../scripts/template-export-core.mjs";
import { EN_DICT } from "@/lib/i18n";
import { BAN_HANG } from "./ban-hang";
import { GENERATED_TEMPLATES, } from "./generated";
import { TemplateFile } from "./index";

const metaDir = fileURLToPath(new URL("../../../scripts/templates", import.meta.url));
const metaFiles = fs.readdirSync(metaDir).filter((f) => f.endsWith(".json")).sort();
const readMeta = (f: string) => JSON.parse(fs.readFileSync(path.join(metaDir, f), "utf8"));

const REAL: Record<string, string> = {
  ngay: "Ngày HĐ", doanh_thu: "DT sau CK", san_pham: "Tên hàng", so_luong: "SL", gia_von: "Giá vốn",
  ma_don: "Số HĐ", tinh_thanh: "Tỉnh", nhan_vien: "Tên NV", khach_hang: "Khách hàng",
};

function realSource(): DataSource {
  return {
    id: "real-src", type: "google_sheets", spreadsheetId: "SECRET_SHEET_ID", sheetName: "Data",
    columns: BAN_HANG.slots.map((s) => ({ name: REAL[s.key], type: s.type })),
  };
}

function realRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    [REAL.ngay]: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
    [REAL.doanh_thu]: 1000 + i,
    [REAL.san_pham]: `SP ${i}`,
    [REAL.so_luong]: i % 5,
    [REAL.gia_von]: 500 + i,
    [REAL.ma_don]: `HD${i}`,
    [REAL.tinh_thanh]: "Hà Nội",
    [REAL.nhan_vien]: i % 2 ? "An" : "Bình",
    [REAL.khach_hang]: i % 3 ? "" : null,
    "Cột không thuộc vai": "bí mật",
  }));
}

const metaBanHang = () => ({ ...readMeta("ban-hang.json"), columns: Object.fromEntries(Object.entries(REAL)) });

/** Mọi tham chiếu cột của dashboard, theo thứ tự (để so sánh hai dashboard bất kể id). */
function refsOf(doc: Dashboard) {
  return {
    widgets: doc.widgets.map((w) => {
      const c = w.config;
      if (c.kind === "chart") return [c.chartType, ...c.dimensions.map((b) => b.column), "|", ...c.metrics.map((b) => b.column)];
      if (c.kind === "kpi") return ["kpi", c.metric.column, c.compare?.dateColumn];
      return [c.kind];
    }),
    filters: doc.filters.map((f) => f.column),
    calc: doc.calculatedFields.map((f) => [f.name, f.expression]),
  };
}

describe("xuất mẫu (vòng tròn với applyTemplate)", () => {
  const original = applyTemplate(BAN_HANG, REAL, realSource()).doc;
  const { template, warnings } = buildTemplate({
    meta: metaBanHang(), doc: original, rows: realRows(100), maxRows: 40,
  });

  it("ra mẫu hợp lệ theo zod và theo quy ước (không tên trần, không cột lạ)", () => {
    const parsed = Template.parse(template);
    expect(validateTemplate(parsed)).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("áp lại mẫu vừa xuất ra đúng các cột ban đầu", () => {
    const again = applyTemplate(Template.parse(template), REAL, realSource()).doc;
    expect(refsOf(again)).toEqual(refsOf(original));
    expect(again.widgets.length).toBe(original.widgets.length);
  });

  it("không để lộ id Sheet thật, bỏ meta cũ, chỉ còn một nguồn mẫu", () => {
    const json = JSON.stringify(template);
    expect(json).not.toContain("SECRET_SHEET_ID");
    expect(json).not.toContain("real-src");
    expect(template.doc.meta).toBeUndefined();
    expect(template.doc.sources).toHaveLength(1);
    expect(template.doc.sources[0].type).toBe("sample");
    expect(template.doc.id).toBe("tpl-ban-hang");
  });

  it("dòng mẫu: tối đa 40 dòng cách đều, chỉ cột thuộc vai, khoá theo vai, ô trống thành null", () => {
    expect(template.sampleRows).toHaveLength(40);
    const keys = new Set(BAN_HANG.slots.map((s) => s.key));
    for (const r of template.sampleRows) {
      for (const k of Object.keys(r)) expect(keys.has(k)).toBe(true);
    }
    expect(JSON.stringify(template.sampleRows)).not.toContain("bí mật");
    expect(template.sampleRows[0].doanh_thu).toBe(1000);
    expect(template.sampleRows[39].doanh_thu).toBe(1000 + Math.floor((39 * 100) / 40));
    expect(template.sampleRows.some((r: Record<string, unknown>) => r.khach_hang === null)).toBe(true);
  });

  it("--rows 0 không lấy dòng nào; ít dòng hơn mức tối đa thì lấy hết", () => {
    expect(buildTemplate({ meta: metaBanHang(), doc: original, rows: realRows(100), maxRows: 0 }).template.sampleRows).toEqual([]);
    expect(buildTemplate({ meta: metaBanHang(), doc: original, rows: realRows(7), maxRows: 40 }).template.sampleRows).toHaveLength(7);
  });
});

describe("xuất mẫu: nối cột và lỗi", () => {
  const nameOf = (s: { label: string }) => s.label;
  /** Dashboard mà cột trong Sheet đặt tên đúng nhãn vai → không cần khai báo "columns". */
  function byLabel() {
    const map = Object.fromEntries(BAN_HANG.slots.map((s) => [s.key, nameOf(s)]));
    const source: DataSource = {
      id: "s", type: "google_sheets", spreadsheetId: "x", sheetName: "D",
      columns: BAN_HANG.slots.map((s) => ({ name: map[s.key], type: s.type })),
    };
    return { map, doc: applyTemplate(BAN_HANG, map, source).doc };
  }

  it("tự nối chính xác theo nhãn/từ đồng nghĩa đã bỏ dấu, không phân biệt hoa thường", () => {
    // Cột viết HOA, không dấu: khớp nhãn "Ngày bán" và từ đồng nghĩa "doanh số".
    const doc = {
      schemaVersion: 1, id: "d", name: "D", canvas: { width: 1000, height: 600, background: "#fff" },
      sources: [{ id: "s", type: "sample", name: "x", columns: [{ name: "NGAY BAN", type: "date" }, { name: "DOANH SO", type: "number" }] }],
      widgets: [{
        id: "k", x: 0, y: 0, w: 200, h: 100,
        config: {
          kind: "kpi", sourceId: "s", metric: { column: "DOANH SO", aggregation: "sum" },
          compare: { to: "prev_period", dateColumn: "NGAY BAN", grain: "month", show: "percent", goodWhen: "up", toDate: true },
        },
      }],
      filters: [{ id: "f", sourceId: "s", column: "NGAY BAN", control: "date_range" }],
      calculatedFields: [],
    };
    const meta = { ...readMeta("ban-hang.json"), columns: {}, slots: readMeta("ban-hang.json").slots.slice(0, 2) };
    const { template } = buildTemplate({ meta, doc, rows: [{ "NGAY BAN": "2025-01-01", "DOANH SO": 5 }] });
    const json = JSON.stringify(template.doc);
    expect(json).toContain('"column":"doanh_thu"');
    expect(json).toContain('"dateColumn":"ngay"');
    expect(template.sampleRows).toEqual([{ ngay: "2025-01-01", doanh_thu: 5 }]);
  });

  it("cột chưa có vai: dừng, nêu tên cột và cách sửa", () => {
    const { doc } = byLabel();
    const meta = { ...readMeta("ban-hang.json"), columns: {} };
    meta.slots = meta.slots.filter((s: { key: string }) => s.key !== "nhan_vien");
    expect(() => buildTemplate({ meta, doc, rows: [] })).toThrow(/"Nhân viên"/);
  });

  it("công thức dùng tên cột trần thì báo lỗi", () => {
    const { doc } = byLabel();
    doc.calculatedFields[0].expression = "Doanh thu - 1";
    expect(() => buildTemplate({ meta: readMeta("ban-hang.json"), doc, rows: [] })).toThrow(/tên cột trần \(Doanh\)|tên cột trần/);
  });

  it("echartsOverride thì báo lỗi", () => {
    const { doc } = byLabel();
    const c = doc.widgets.map((w) => w.config).find((x) => x.kind === "chart");
    if (c?.kind === "chart") c.echartsOverride = { a: 1 };
    expect(() => buildTemplate({ meta: readMeta("ban-hang.json"), doc, rows: [] })).toThrow(/echartsOverride/);
  });

  it("dashboard dùng nhiều nguồn thì báo lỗi", () => {
    const { doc } = byLabel();
    const k = doc.widgets.find((w) => w.config.kind === "kpi");
    if (k && k.config.kind === "kpi") k.config.sourceId = "nguon-khac";
    expect(() => buildTemplate({ meta: readMeta("ban-hang.json"), doc, rows: [] })).toThrow(/đúng 1 nguồn/);
  });

  it('"columns" sai: khoá vai lạ hoặc cột không có trong nguồn', () => {
    const { doc } = byLabel();
    expect(() => buildTemplate({ meta: { ...readMeta("ban-hang.json"), columns: { khong_co: "Doanh thu" } }, doc, rows: [] })).toThrow(/khoá vai lạ/);
    expect(() => buildTemplate({ meta: { ...readMeta("ban-hang.json"), columns: { doanh_thu: "Cột bịa" } }, doc, rows: [] })).toThrow(/không có trong nguồn/);
  });

  it("cảnh báo (không chặn): lệch kiểu cột, vai không dùng, vai bắt buộc chưa nối", () => {
    const { doc } = byLabel();
    const src = doc.sources[0];
    if (src.type === "google_sheets") src.columns = src.columns.map((c) => (c.name === "Doanh thu" ? { ...c, type: "string" as const } : c));
    const meta = readMeta("ban-hang.json");
    meta.slots.push({ key: "dung_thua", label: "Vai thừa", type: "string", required: true, synonyms: [] });
    const { warnings } = buildTemplate({ meta, doc, rows: [] });
    expect(warnings.join("|")).toMatch(/doanh_thu.*kiểu number nhưng cột "Doanh thu" kiểu string/);
    expect(warnings.join("|")).toMatch(/"dung_thua" không được/);
    expect(warnings.join("|")).toMatch(/bắt buộc "dung_thua" chưa nối/);
  });
});

describe("quét công thức của script khớp với schema", () => {
  for (const f of [
    "[a] + [b c]", 'IF([x] = "[y]", 1, 0)', "SUM([Doanh thu]) / SUM([Đơn])", "doanh_thu * 2", "1e5 + [a]",
    "IF(TRUE AND NOT FALSE, NULL, [z])", "ROUND ([a], 2)", "'it\\'s [no]' & [yes]",
  ]) {
    it(f, () => {
      expect(scanFormula(f)).toEqual(schemaScan(f));
    });
  }
});

describe("file khai báo vai (scripts/templates)", () => {
  it("có đủ 5 mẫu", () => {
    expect(metaFiles).toEqual(["ban-hang.json", "ton-kho.json", "thu-chi.json", "thuong-mai-dien-tu.json", "quang-cao-facebook.json"].sort());
  });

  for (const f of metaFiles) {
    describe(f, () => {
      const meta = readMeta(f);
      it("id trùng tên file, slots hợp lệ theo zod, khoá không trùng, có vai bắt buộc, từ đồng nghĩa không rỗng", () => {
        expect(meta.id).toBe(f.replace(/\.json$/, ""));
        const slots = meta.slots.map((s: unknown) => Slot.parse(s));
        const keys = slots.map((s: { key: string }) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(slots.some((s: { required: boolean }) => s.required)).toBe(true);
        expect(slots.some((s: { type: string }) => s.type === "date")).toBe(true);
        expect(slots.some((s: { type: string }) => s.type === "number")).toBe(true);
        for (const s of slots) expect(s.synonyms.length, s.key).toBeGreaterThan(0);
        expect(meta.version).toBeGreaterThanOrEqual(1);
      });

      it('"columns" chỉ chứa khoá vai có thật', () => {
        const keys = new Set(meta.slots.map((s: { key: string }) => s.key));
        for (const k of Object.keys(meta.columns ?? {})) expect(keys.has(k), k).toBe(true);
      });

      it("tên, mô tả, ngành, nhãn vai đều có bản dịch tiếng Anh", () => {
        const texts = [meta.industry, meta.name, meta.description, ...meta.slots.map((s: { label: string }) => s.label)];
        const missing = texts.filter((t: string) => !(t in EN_DICT));
        expect(missing).toEqual([]);
      });

      it("từ đồng nghĩa của hai vai khác nhau không trùng nhau sau khi bỏ dấu", () => {
        const seen = new Map<string, string>();
        for (const s of meta.slots as { key: string; synonyms: string[] }[]) {
          for (const syn of s.synonyms) {
            const n = normalizeText(syn);
            const owner = seen.get(n);
            expect(owner === undefined || owner === s.key, `"${syn}" trùng giữa ${owner} và ${s.key}`).toBe(true);
            seen.set(n, s.key);
          }
        }
      });
    });
  }

  it("ban-hang.json khớp slots của mẫu viết tay BAN_HANG", () => {
    const meta = readMeta("ban-hang.json");
    expect(meta.slots.map((s: unknown) => Slot.parse(s))).toEqual(BAN_HANG.slots);
  });
});

describe("generated.ts", () => {
  it("mọi mẫu đã xuất đều hợp lệ theo zod và theo quy ước", () => {
    for (const raw of GENERATED_TEMPLATES) {
      const e = TemplateFile.parse(raw);
      expect(validateTemplate(e.template), e.template.id).toEqual([]);
    }
  });
});
