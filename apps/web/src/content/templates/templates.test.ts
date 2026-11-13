import { describe, expect, it } from "vitest";
import { applyTemplate, Dashboard, matchColumns, validateTemplate, type DataSource } from "@dashboard/schema";
import { calcDefsFor, runQuery, specForWidget, type Row } from "@dashboard/chart-engine";
import { TEMPLATES, templateIndustries } from "./index";

describe("thư viện mẫu", () => {
  it("id mẫu không trùng", () => {
    const ids = TEMPLATES.map((t) => t.template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const { template: t } of TEMPLATES) {
    describe(t.id, () => {
      it("đúng quy ước mẫu", () => {
        expect(validateTemplate(t)).toEqual([]);
      });

      it("có dữ liệu mẫu đủ các vai bắt buộc", () => {
        expect(t.sampleRows.length).toBeGreaterThanOrEqual(30);
        for (const s of t.slots.filter((x) => x.required)) {
          expect(t.sampleRows.every((r) => r[s.key] != null), s.key).toBe(true);
        }
      });

      it("tạo được dashboard hợp lệ khi đủ vai và khi chỉ có vai bắt buộc", () => {
        const source = (slots: typeof t.slots): DataSource => ({
          id: "s1", type: "google_sheets", spreadsheetId: "x", sheetName: "Data",
          columns: slots.map((s) => ({ name: `Cột ${s.label}`, type: s.type })),
        });
        const full = source(t.slots);
        const all = applyTemplate(t, Object.fromEntries(t.slots.map((s) => [s.key, `Cột ${s.label}`])), full);
        expect(Dashboard.safeParse(all.doc).success).toBe(true);
        expect(all.dropped.widgets).toEqual([]);

        const req = t.slots.filter((s) => s.required);
        const min = applyTemplate(t, Object.fromEntries(req.map((s) => [s.key, `Cột ${s.label}`])), source(req));
        expect(Dashboard.safeParse(min.doc).success).toBe(true);
        expect(min.doc.widgets.length).toBeGreaterThan(0);
        // Không widget nào còn trỏ tới cột không có trong nguồn.
        const cols = new Set([...req.map((s) => `Cột ${s.label}`), ...min.doc.calculatedFields.map((f) => f.name), ""]);
        for (const w of min.doc.widgets) {
          const c = w.config;
          const refs = c.kind === "chart" ? [...c.dimensions, ...c.metrics].map((b) => b.column) : c.kind === "kpi" ? [c.metric.column] : [];
          for (const r of refs) expect(cols.has(r), `${w.id}: ${r}`).toBe(true);
        }
      });

      it("tự khớp được cột đặt tên theo nhãn hoặc từ đồng nghĩa đầu tiên của từng vai", () => {
        for (const pick of ["label", "synonym"] as const) {
          const columns = t.slots.map((s) => ({ name: pick === "label" ? s.label : (s.synonyms[0] ?? s.label), type: s.type }));
          const r = matchColumns(t.slots, columns);
          expect(r.mapping, pick).toEqual(Object.fromEntries(t.slots.map((s, i) => [s.key, columns[i].name])));
        }
      });

      it("mọi widget có số liệu thật trên dữ liệu mẫu (không trống, không NaN)", () => {
        const names = Object.fromEntries(t.slots.map((s) => [s.key, s.key]));
        const source: DataSource = {
          id: "s1", type: "google_sheets", spreadsheetId: "x", sheetName: "Data",
          columns: t.slots.map((s) => ({ name: s.key, type: s.type })),
        };
        const { doc } = applyTemplate(t, names, source);
        const calc = calcDefsFor(doc.calculatedFields, "s1");
        const rows = t.sampleRows as Row[];
        let checked = 0;
        for (const w of doc.widgets) {
          const q = specForWidget(w, [], calc);
          if (!q) continue;
          const res = runQuery(rows, q.spec);
          expect(res.mode, w.id).toBe("aggregate");
          if (res.mode !== "aggregate") continue;
          expect(res.table.rows.length, `${w.id}: không có nhóm nào`).toBeGreaterThan(0);
          const values = res.table.rows.flatMap((r) => r.values);
          expect(values.every((v) => v === null || Number.isFinite(v)), `${w.id}: có NaN/Infinity`).toBe(true);
          expect(values.some((v) => v !== null && v !== 0), `${w.id}: toàn số 0 hoặc trống`).toBe(true);
          checked++;
        }
        expect(checked).toBeGreaterThanOrEqual(8);
      });

      it("ban-hang vẫn khớp được cột viết tắt thường gặp", () => {
        if (t.id !== "ban-hang") return;
        const r = matchColumns(t.slots, [
          { name: "Ngày HĐ", type: "date" },
          { name: "DT sau CK", type: "number" },
          { name: "Tên hàng", type: "string" },
          { name: "SL", type: "number" },
          { name: "Tỉnh", type: "string" },
          { name: "Tên NV", type: "string" },
        ]);
        expect(r.mapping).toMatchObject({
          ngay: "Ngày HĐ", doanh_thu: "DT sau CK", san_pham: "Tên hàng", so_luong: "SL", tinh_thanh: "Tỉnh", nhan_vien: "Tên NV",
        });
      });
    });
  }

  it("liệt kê ngành không trùng", () => {
    const inds = templateIndustries();
    expect(new Set(inds).size).toBe(inds.length);
  });
});
