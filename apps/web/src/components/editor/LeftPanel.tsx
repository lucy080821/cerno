"use client";

import { resolvePageId, widgetsOnPage } from "@dashboard/schema";
import { useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { useData } from "@/lib/editor/data-store";
import { CalcFieldDialog } from "./CalcFieldDialog";
import { PagesPanel } from "./PagesPanel";
import { createWidget, NEW_WIDGET_LABEL, widgetLabel, type NewWidgetKind } from "@/lib/editor/defaults";
import { CHART_TYPE_ORDER } from "@dashboard/chart-engine";
import { Icon, Section } from "./fields";
import s from "./editor.module.css";

// Biểu đồ trước (theo thứ tự trong CHART_TYPE_ORDER), rồi KPI / văn bản / ảnh.
const KINDS: NewWidgetKind[] = [...CHART_TYPE_ORDER, "kpi", "text", "image"];

const KIND_GLYPH: Record<NewWidgetKind, string> = {
  bar: "M5 20V10M12 20V4M19 20v-7",
  line: "M3 17l6-6 4 4 8-9",
  area: "M3 17l6-6 4 4 8-9v11H3z",
  pie: "M12 3v9h9A9 9 0 1 1 12 3z",
  table: "M3 5h18v14H3zM3 10h18M9 5v14",
  kpi: "M4 18l5-5 3 3 8-9M16 7h4v4",
  text: "M5 6h14M12 6v13M9 19h6",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4",
  hbar: "M4 5h10M4 12h16M4 19h7",
  histogram: "M3 20V14h4v6M7 20V5h5v15M12 20V9h5v11M17 20v-4h4v4",
  stackedbar: "M5 20v-6M5 14v-4M12 20v-9M12 11V5M19 20v-4M19 16v-3",
  funnel: "M3 5h18l-6 7v7l-4-2v-5z",
  treemap: "M3 4h18v16H3zM12 4v16M12 11h9",
  scatter:
    "M6 17a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M11 9a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M16 14a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M16 5a1 1 0 1 0 2 0 1 1 0 1 0-2 0",
  radar: "M12 3l8.5 6.2-3.2 10H6.7l-3.2-10zM12 9l4 3-1.5 4h-5L8 12z",
  gauge: "M4 17a8 8 0 1 1 16 0M12 17l4-5",
  heatmap: "M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z",
};

const TYPE_BADGE: Record<string, string> = { number: "123", string: "Abc", date: "Ngày", boolean: "T/F" };

export function LeftPanel() {
  const doc = useEditor((st) => st.doc);
  const selection = useEditor((st) => st.selection);
  const viewport = useEditor((st) => st.viewport);
  const view = useEditor((st) => st.view);
  const addWidget = useEditor((st) => st.addWidget);
  const select = useEditor((st) => st.select);
  const patchWidget = useEditor((st) => st.patchWidget);

  const add = (kind: NewWidgetKind) => {
    // Đặt widget mới vào giữa vùng đang nhìn, lệch nhẹ để các widget không chồng khít nhau.
    const cx = (viewport.w / 2 - view.x) / view.zoom;
    const cy = (viewport.h / 2 - view.y) / view.zoom;
    const probe = createWidget(kind, { x: 0, y: 0 });
    const n = widgetsOnPage(doc, useEditor.getState().pageId).length % 6;
    addWidget(createWidget(kind, {
      x: Math.max(0, cx - probe.w / 2 + n * 20),
      y: Math.max(0, cy - probe.h / 2 + n * 20),
    }, doc.sources[0]?.id, doc.sources[0]?.columns));
  };

  const pageId = useEditor((st) => resolvePageId(st.doc, st.pageId));
  const pageWidgets = widgetsOnPage(doc, pageId);
  const layers = [...pageWidgets].sort((a, b) => b.z - a.z);
  const source = doc.sources[0];
  const [calcDlg, setCalcDlg] = useState<{ fieldId?: string } | null>(null);
  const calcSet = useData((st) => (source ? st.calc[source.id] : undefined));
  const calcFields = source ? doc.calculatedFields.filter((f) => f.sourceId === source.id) : [];

  return (
    <aside className={s.left}>
      <PagesPanel />

      <Section title="Thêm vào canvas">
        <div className={s.addGrid}>
          {KINDS.map((k) => (
            <button key={k} className={s.addTile} onClick={() => add(k)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
                strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={KIND_GLYPH[k]} />
              </svg>
              <span>{NEW_WIDGET_LABEL[k]}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title={`Lớp (${layers.length})`}>
        <ul className={s.layers}>
          {layers.map((w) => (
            <li
              key={w.id}
              className={`${s.layer} ${selection.includes(w.id) ? s.layerActive : ""} ${w.hidden ? s.layerHidden : ""}`}
              onClick={() => select([w.id])}
            >
              <span className={s.layerName}>{widgetLabel(w)}</span>
              <button className={s.iconBtn} title={w.locked ? "Mở khoá" : "Khoá"}
                onClick={(e) => { e.stopPropagation(); patchWidget(w.id, { locked: !w.locked }); }}>
                <Icon name={w.locked ? "lock" : "unlock"} size={13} />
              </button>
              <button className={s.iconBtn} title={w.hidden ? "Hiện" : "Ẩn"}
                onClick={(e) => { e.stopPropagation(); patchWidget(w.id, { hidden: !w.hidden }); }}>
                <Icon name={w.hidden ? "eyeOff" : "eye"} size={13} />
              </button>
            </li>
          ))}
          {layers.length === 0 && <li className={s.hint}>Chưa có đối tượng nào.</li>}
        </ul>
      </Section>

      {source && (
        <Section title="Trường dữ liệu">
          <ul className={s.fields}>
            {source.columns.map((c) => (
              <li key={c.name}>
                <span className={`${s.badge} ${c.type === "number" ? s.badgeNum : ""}`}>{TYPE_BADGE[c.type]}</span>
                {c.name}
              </li>
            ))}
            {calcFields.map((f) => {
              const err = calcSet?.errors.get(f.name.trim()) ?? calcSet?.errors.get(f.id);
              const agg = !err && calcSet?.aggFields.has(f.name.trim());
              return (
                <li key={f.id} className={s.fieldCalc}>
                  <span className={`${s.badge} ${err ? s.badgeErr : s.badgeCalc}`}
                    title={err ?? (agg ? "Trường tổng hợp: dùng làm số đo" : "Trường tính theo dòng")}>
                    {err ? "Lỗi" : "ƒx"}
                  </span>
                  <span className={s.calcName} title={f.expression}>{f.name}</span>
                  <button className={s.iconBtn} title="Sửa công thức" onClick={() => setCalcDlg({ fieldId: f.id })}>
                    <Icon name="pencil" size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
          <button className={s.addBtn} onClick={() => setCalcDlg({})}>
            <Icon name="plus" size={12} /> Trường tính toán
          </button>
          {calcDlg && source && (
            <CalcFieldDialog key={calcDlg.fieldId ?? "new"} sourceId={source.id} fieldId={calcDlg.fieldId}
              onClose={() => setCalcDlg(null)} />
          )}
        </Section>
      )}
    </aside>
  );
}
