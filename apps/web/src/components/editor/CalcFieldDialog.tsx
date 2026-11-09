"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  FUNCTION_DOCS,
  MAX_EXPRESSION_LENGTH,
  compileCalcFields,
  evalAggField,
  formatNumber,
  materializeRows,
  unknownRefs,
} from "@dashboard/chart-engine";
import { useEditor } from "@/lib/editor/store";
import { getRawRows } from "@/lib/editor/sample-data";
import { useIsRemote } from "@/lib/editor/data-store";
import { useRemoteQuery } from "@/lib/editor/remote-query";
import { countUsage, newCalcId, renameColumnEverywhere } from "@/lib/editor/calc";
import { Icon } from "./fields";
import s from "./editor.module.css";
import { Spinner } from "@/components/Spinner";
import { useDialog } from "@/components/ui/DialogProvider";

const MAX_FIELDS = 50;
const PREVIEW_ROWS = 5;

const EXAMPLES: Array<{ label: string; name: string; expr: string }> = [
  { label: "Lợi nhuận = Doanh thu − Chi phí", name: "Lợi nhuận", expr: "[Doanh thu] - [Chi phí]" },
  { label: "Giá trị đơn trung bình", name: "Giá trị đơn TB", expr: "SUM([Doanh thu]) / SUM([Đơn hàng])" },
  { label: "Phân loại theo ngưỡng", name: "Mức doanh thu", expr: 'IF([Doanh thu] >= 1000000, "Cao", "Thấp")' },
  { label: "Lấy tháng từ ngày", name: "Tháng", expr: "YEAR_MONTH([Ngày])" },
];

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(trống)";
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "boolean") return v ? "Đúng" : "Sai";
  return String(v);
}

/** Khung tạo/sửa một trường tính toán: công thức, danh sách cột/hàm để chèn, và xem thử kết quả ngay. */
export function CalcFieldDialog({ sourceId, fieldId, onClose }: { sourceId: string; fieldId?: string; onClose: () => void }) {
  const dialog = useDialog();
  const doc = useEditor((st) => st.doc);
  const mutate = useEditor((st) => st.mutate);
  const existing = fieldId ? doc.calculatedFields.find((f) => f.id === fieldId) : undefined;
  const source = doc.sources.find((x) => x.id === sourceId);
  const baseNames = useMemo(() => source?.columns.map((c) => c.name) ?? [], [source]);

  const [id] = useState(() => fieldId ?? newCalcId());
  const [name, setName] = useState(existing?.name ?? "");
  const [expr, setExpr] = useState(existing?.expression ?? "");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const deferred = useDeferredValue(expr);
  const deferredName = useDeferredValue(name);

  useEffect(() => {
    taRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trimmed = deferredName.trim();
  const others = useMemo(
    () => doc.calculatedFields.filter((f) => f.sourceId === sourceId && f.id !== id),
    [doc.calculatedFields, sourceId, id],
  );

  // Biên dịch cùng các trường khác để bắt lỗi trùng tên, vòng lặp, phụ thuộc trường tổng hợp.
  const result = useMemo(() => {
    const defs = [...others, { id, name: deferredName, expression: deferred }];
    const set = compileCalcFields(defs, baseNames);
    const field = set.aggFields.get(trimmed) ?? set.rowFields.find((f) => f.name === trimmed);
    const error = (trimmed ? set.errors.get(trimmed) : undefined) ?? set.errors.get(id) ?? (deferred.trim() ? undefined : "Chưa nhập công thức.");
    return { set, field, error };
  }, [others, id, deferredName, deferred, baseNames, trimmed]);

  // Nguồn lớn: trình duyệt chỉ có ~500 dòng mẫu, nên công thức tổng hợp phải để server tính trên toàn bộ dữ liệu.
  const isRemote = useIsRemote(sourceId);
  const draftCalc = useMemo(
    () => [...others, { id, name: deferredName, expression: deferred }].map((f) => ({ id: f.id, name: f.name, expression: f.expression })),
    [others, id, deferredName, deferred],
  );
  const remoteAgg = useRemoteQuery(
    sourceId,
    isRemote && result.field?.kind === "agg"
      ? { mode: "aggregate", dims: [], metrics: [{ column: trimmed }], filters: [], calc: draftCalc }
      : null,
    300,
  );

  const preview = useMemo(() => {
    const { field, set } = result;
    if (!field) return null;
    if (field.kind === "agg" && isRemote) {
      return remoteAgg.data?.mode === "aggregate" ? { agg: remoteAgg.data.table.rows[0]?.values[0] ?? 0 } : null;
    }
    const raw = getRawRows(sourceId);
    if (field.kind === "agg") return { agg: evalAggField(field, materializeRows(raw, set)) };
    const head = materializeRows(raw.slice(0, PREVIEW_ROWS), set);
    return { rows: head.map((r) => r[field.name]) };
  }, [result, sourceId, isRemote, remoteAgg.data]);

  const missing = useMemo(
    () => unknownRefs({ id, name: deferredName, expression: deferred }, [...baseNames, ...others.map((o) => o.name.trim())]),
    [id, deferredName, deferred, baseNames, others],
  );

  const insert = (text: string, caretBack = 0) => {
    const ta = taRef.current;
    const a = ta?.selectionStart ?? expr.length;
    const b = ta?.selectionEnd ?? expr.length;
    const next = expr.slice(0, a) + text + expr.slice(b);
    if (next.length > MAX_EXPRESSION_LENGTH) return;
    setExpr(next);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const p = a + text.length - caretBack;
      ta.setSelectionRange(p, p);
    });
  };

  const nameOk = name.trim().length > 0 && name.trim().length <= 80;
  const tooMany = !existing && doc.calculatedFields.length >= MAX_FIELDS;
  // Chỉ lưu khi đúng công thức mới nhất (không phải bản "hoãn" của useDeferredValue).
  const settled = deferred === expr && deferredName === name;
  const canSave = nameOk && !result.error && !!result.field && settled && !tooMany;

  const save = () => {
    if (!canSave) return;
    const next = { id, sourceId, name: name.trim(), expression: expr.trim() };
    mutate((d) => {
      const list = existing
        ? d.calculatedFields.map((f) => (f.id === id ? next : f))
        : [...d.calculatedFields, next];
      let out = { ...d, calculatedFields: list };
      if (existing && existing.name.trim() !== next.name) out = renameColumnEverywhere(out, sourceId, existing.name.trim(), next.name);
      return out;
    }, `calc:${id}:${Date.now()}`);
    onClose();
  };

  const remove = async () => {
    if (!existing) return;
    const u = countUsage(doc, sourceId, existing.name.trim());
    const used = u.widgets + u.filters > 0
      ? `\n\nĐang được dùng ở ${u.widgets} widget và ${u.filters} bộ lọc. Các chỗ đó sẽ hiện trống cho tới khi bạn chọn trường khác.`
      : "";
    const ok = await dialog.confirm({
      title: "Xóa trường tính toán?",
      message: `Xóa trường "${existing.name}"?${used}`,
      confirmText: "Xóa trường",
      tone: "danger",
    });
    if (!ok) return;
    mutate((d) => ({ ...d, calculatedFields: d.calculatedFields.filter((f) => f.id !== id) }), `calc-del:${id}`);
    onClose();
  };

  const groups = useMemo(() => {
    const m = new Map<string, typeof FUNCTION_DOCS>();
    for (const f of FUNCTION_DOCS) m.set(f.group, [...(m.get(f.group) ?? []), f]);
    return [...m.entries()];
  }, []);

  return (
    <div className={s.modalBack} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-label="Trường tính toán">
        <div className={s.modalHead}>
          <strong>{existing ? "Sửa trường tính toán" : "Trường tính toán mới"}</strong>
          <button className={s.iconBtn} title="Đóng (Esc)" onClick={onClose}><Icon name="close" size={14} /></button>
        </div>

        <div className={s.modalBody}>
          <div className={s.calcMain}>
            <label className={s.label} htmlFor="calc-name">Tên trường</label>
            <input id="calc-name" className={s.input} value={name} maxLength={80} placeholder="Ví dụ: Lợi nhuận"
              onChange={(e) => setName(e.target.value)} />

            <label className={s.label} htmlFor="calc-expr">Công thức</label>
            <textarea
              id="calc-expr"
              ref={taRef}
              className={`${s.input} ${s.calcExpr}`}
              value={expr}
              spellCheck={false}
              placeholder="[Doanh thu] - [Chi phí]"
              maxLength={MAX_EXPRESSION_LENGTH}
              onChange={(e) => setExpr(e.target.value)}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") save(); }}
            />

            {result.error ? (
              <p className={s.calcError} role="alert">{result.error}</p>
            ) : (
              <p className={s.calcOk}>
                {result.field?.kind === "agg"
                  ? "Công thức tổng hợp: dùng làm Số đo của chart (tính theo từng nhóm)."
                  : "Công thức theo dòng: dùng như một cột mới (làm chiều, hoặc làm số đo với Tổng/Trung bình…)."}
              </p>
            )}
            {missing.length > 0 && !result.error && (
              <p className={s.calcWarn}>Không thấy cột: {missing.map((m) => `[${m}]`).join(", ")}. Kết quả sẽ là trống.</p>
            )}

            {!preview && isRemote && !result.error && result.field?.kind === "agg" && (
              <div className={s.calcPreview}>
                <span className={s.label}>Xem thử</span>
                <p className={s.hint}><Spinner size={12} inline />Đang tính trên toàn bộ dữ liệu…</p>
              </div>
            )}
            {preview && (
              <div className={s.calcPreview}>
                <span className={s.label}>Xem thử</span>
                {"agg" in preview ? (
                  <div className={s.calcPreviewRow}><span>Trên toàn bộ dữ liệu</span><b>{show(preview.agg)}</b></div>
                ) : preview.rows.length === 0 ? (
                  <p className={s.hint}>Chưa có dữ liệu để xem thử.</p>
                ) : (
                  preview.rows.map((v, i) => (
                    <div key={i} className={s.calcPreviewRow}><span>Dòng {i + 1}</span><b>{show(v)}</b></div>
                  ))
                )}
              </div>
            )}

            {!expr.trim() && (
              <div className={s.calcExamples}>
                <span className={s.label}>Ví dụ (bấm để dùng thử, sửa tên cột cho khớp dữ liệu của bạn)</span>
                {EXAMPLES.map((ex) => (
                  <button key={ex.label} type="button" className={s.smallBtn}
                    onClick={() => { setName((n) => n || ex.name); setExpr(ex.expr); }}>{ex.label}</button>
                ))}
              </div>
            )}
          </div>

          <div className={s.calcSide}>
            <span className={s.label}>Cột (bấm để chèn)</span>
            <div className={s.chipWrap}>
              {[...baseNames, ...others.map((o) => o.name.trim())].map((c) => (
                <button key={c} type="button" className={s.chip} onClick={() => insert(`[${c}]`)}>{c}</button>
              ))}
            </div>
            <span className={s.label}>Hàm (bấm để chèn)</span>
            {groups.map(([g, fns]) => (
              <div key={g} className={s.fnGroup}>
                <span className={s.fnGroupTitle}>{g}</span>
                <div className={s.chipWrap}>
                  {fns.map((f) => (
                    <button key={f.name} type="button" className={s.chip} title={`${f.sig}: ${f.desc}`}
                      onClick={() => insert(`${f.name}()`, 1)}>{f.name}</button>
                  ))}
                </div>
              </div>
            ))}
            <p className={s.hint}>
              Toán tử: + − * / %, nối chữ &amp;, so sánh = &lt;&gt; &lt; &gt; &lt;= &gt;=, AND / OR / NOT.
              Tên cột có dấu cách viết trong [ ]. Chuỗi chữ để trong &quot; &quot;.
            </p>
          </div>
        </div>

        <div className={s.modalFoot}>
          {existing && <button className={`${s.smallBtn} ${s.danger}`} onClick={remove}>Xoá trường</button>}
          {tooMany && <span className={s.calcError}>Tối đa {MAX_FIELDS} trường.</span>}
          <span style={{ flex: 1 }} />
          <button className={s.btn} onClick={onClose}>Huỷ</button>
          <button className={`${s.btn} ${s.btnActive}`} disabled={!canSave} onClick={save} title="Ctrl+Enter">Lưu</button>
        </div>
      </div>
    </div>
  );
}
