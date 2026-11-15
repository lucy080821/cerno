import { describe, expect, it } from "vitest";
import { Dashboard } from "@dashboard/schema";
import { calcDefsFor, runQuery, specForWidget } from "@dashboard/chart-engine";
import { TEMPLATES } from "@/content/templates";
import { buildTemplatePreview } from "./preview";

describe("bản xem trước của mẫu", () => {
  for (const { template: t } of TEMPLATES) {
    describe(t.id, () => {
      const p = buildTemplatePreview(t);
      const [sourceId] = Object.keys(p.rows);

      it("là dashboard hợp lệ, dùng đúng một nguồn có dữ liệu", () => {
        expect(Dashboard.safeParse(p.doc).success).toBe(true);
        expect(p.doc.sources.map((s) => s.id)).toEqual([sourceId]);
        expect(p.doc.widgets.length).toBeGreaterThan(0);
        expect(p.sourceRows[sourceId]).toBe(t.sampleRows.length);
        expect(p.rows[sourceId]).toHaveLength(t.sampleRows.length);
      });

      it("tên cột là nhãn của vai (đọc được), không lộ khoá vai", () => {
        const names = new Set(Object.keys(p.rows[sourceId][0]));
        expect(names).toEqual(new Set(t.slots.map((s) => s.label)));
        expect(new Set(t.slots.map((s) => s.label)).size).toBe(t.slots.length); // nhãn không trùng nhau
        const cfgs = p.doc.widgets.map((w) => w.config);
        for (const c of cfgs) {
          const refs = c.kind === "chart" ? [...c.dimensions, ...c.metrics].map((b) => b.column) : c.kind === "kpi" ? [c.metric.column] : [];
          const calc = new Set(p.doc.calculatedFields.map((f) => f.name));
          for (const r of refs) expect(names.has(r) || calc.has(r), r).toBe(true);
        }
      });

      it("mọi widget có số liệu thật trên dữ liệu mẫu", () => {
        const calc = calcDefsFor(p.doc.calculatedFields, sourceId);
        let checked = 0;
        for (const w of p.doc.widgets) {
          const q = specForWidget(w, [], calc);
          if (!q) continue;
          const res = runQuery(p.rows[sourceId], q.spec);
          expect(res.mode).toBe("aggregate");
          if (res.mode === "aggregate") expect(res.table.rows.length, w.id).toBeGreaterThan(0);
          checked++;
        }
        expect(checked).toBeGreaterThanOrEqual(8);
      });

      it("dựng lại cho cùng kết quả (id tất định)", () => {
        expect(buildTemplatePreview(t).doc).toEqual(p.doc);
      });
    });
  }
});
