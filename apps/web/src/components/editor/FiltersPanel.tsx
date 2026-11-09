"use client";

import { useMemo } from "react";
import { getPages, pageIdOf, type Filter } from "@dashboard/schema";
import { useEditor } from "@/lib/editor/store";
import { widgetLabel } from "@/lib/editor/defaults";
import { getRows } from "@/lib/editor/sample-data";
import { useDataVersion, useIsRemote } from "@/lib/editor/data-store";
import { calcDefsFor, useRemoteQuery } from "@/lib/editor/remote-query";
import { dateBounds, DEFAULT_GRAINS, distinctValues, GRAIN_LABEL, numberRange } from "@/lib/editor/filters";
import { columnsWithCalc, nonAggregateColumns } from "@/lib/editor/calc";
import { Icon, Section, SelectField, TextField, Toggle } from "./fields";
import { Spinner } from "@/components/Spinner";
import s from "./editor.module.css";

const CONTROLS = [
  { value: "dropdown", label: "Chọn một giá trị" },
  { value: "multiselect", label: "Chọn nhiều giá trị" },
  { value: "slider", label: "Khoảng số (từ – đến)" },
  { value: "date_range", label: "Khoảng ngày" },
  { value: "grain", label: "Chọn cấp thời gian (Ngày/Tuần/Tháng…)" },
] as const;

const ALL_GRAINS = Object.keys(GRAIN_LABEL) as Array<keyof typeof GRAIN_LABEL>;

const NO_ROWS: Array<Record<string, never>> = [];
const NO_OPTIONS: string[] = [];

/** Ô điều khiển của một bộ lọc. Dùng cả trong tab Bộ lọc và thanh lọc khi xem. */
export function FilterControl({ filter, compact = false }: { filter: Filter; compact?: boolean }) {
  const value = useEditor((st) => st.filterValues[filter.id]);
  const setValue = useEditor((st) => st.setFilterValue);
  const dataVersion = useDataVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // Nguồn lớn: không có đủ dòng ở trình duyệt, nên hỏi server các giá trị khác nhau / khoảng số / khoảng ngày của cột.
  const remote = useIsRemote(filter.sourceId);
  const calcFields = useEditor((st) => st.doc.calculatedFields);
  const stats = useRemoteQuery(
    filter.sourceId,
    remote && filter.control !== "grain" ? { mode: "stats", column: filter.column, calc: calcDefsFor(calcFields, filter.sourceId) } : null,
    0,
  );
  const rows = useMemo(() => (remote ? NO_ROWS : getRows(filter.sourceId)), [remote, filter.sourceId, dataVersion]);
  const s0 = stats.data?.mode === "stats" ? stats.data : null;
  const localOptions = useMemo(() => distinctValues(rows, filter.column), [rows, filter.column]);
  const localRange = useMemo(() => numberRange(rows, filter.column), [rows, filter.column]);
  const localDates = useMemo(() => (filter.control === "date_range" ? dateBounds(rows, filter.column) : null), [rows, filter]);
  const options = remote ? s0?.distinct ?? NO_OPTIONS : localOptions;
  const range = remote ? s0?.numeric ?? null : localRange;
  const dates = remote ? (filter.control === "date_range" ? s0?.date ?? null : null) : localDates;
  const label = filter.label || filter.column;
  // Nguồn lớn: chưa có danh sách giá trị từ server thì hiện vòng quay thay vì ô trống.
  if (remote && filter.control !== "grain" && !s0 && !stats.error) {
    return <div className={s.hint}><Spinner size={12} inline />{label}: đang tải…</div>;
  }

  if (filter.control === "grain") {
    const grains = filter.grains?.length ? filter.grains : DEFAULT_GRAINS;
    return (
      <div className={compact ? s.fcCompact : s.fc}>
        <span className={s.fcLabel}>{filter.label || "Xem theo"}</span>
        <span className={s.grainSwitch} role="group" aria-label={filter.label || "Xem theo"}>
          <button type="button" className={`${s.preset} ${!value?.values?.length ? s.presetOn : ""}`}
            title="Giữ cấp thời gian đã đặt ở từng widget" onClick={() => setValue(filter.id, null)}>Mặc định</button>
          {grains.map((g) => (
            <button key={g} type="button" className={`${s.preset} ${value?.values?.[0] === g ? s.presetOn : ""}`}
              onClick={() => setValue(filter.id, { values: [g] })}>{GRAIN_LABEL[g]}</button>
          ))}
        </span>
      </div>
    );
  }

  if (filter.control === "date_range") {
    const update = (p: { from?: string; to?: string }) => {
      const next = { from: value?.from, to: value?.to, ...p };
      setValue(filter.id, !next.from && !next.to ? null : next);
    };
    // Lối tắt tính từ ngày mới nhất trong dữ liệu (không phải ngày hôm nay, vì dữ liệu có thể là quá khứ).
    const lastDays = (n: number) => {
      if (!dates) return;
      const end = new Date(dates.max + "T00:00:00Z");
      end.setUTCDate(end.getUTCDate() - (n - 1));
      const from = end.toISOString().slice(0, 10);
      update({ from: from < dates.min ? dates.min : from, to: dates.max });
    };
    return (
      <div className={compact ? s.fcCompact : s.fc}>
        <span className={s.fcLabel}>{label}</span>
        <span className={s.fcRange}>
          <input className={s.input} type="date" value={value?.from ?? ""} min={dates?.min} max={value?.to || dates?.max}
            onChange={(e) => update({ from: e.target.value || undefined })} aria-label={`${label}: từ ngày`} />
          <em>–</em>
          <input className={s.input} type="date" value={value?.to ?? ""} min={value?.from || dates?.min} max={dates?.max}
            onChange={(e) => update({ to: e.target.value || undefined })} aria-label={`${label}: đến ngày`} />
        </span>
        {!compact && dates && (
          <span className={s.datePresets}>
            {[7, 30, 90].map((n) => <button key={n} type="button" className={s.preset} onClick={() => lastDays(n)}>{n} ngày cuối</button>)}
            <button type="button" className={s.preset} onClick={() => setValue(filter.id, null)}>Tất cả</button>
          </span>
        )}
      </div>
    );
  }

  if (filter.control === "slider") {
    const num = (raw: string) => (raw === "" || !Number.isFinite(Number(raw)) ? undefined : Number(raw));
    const update = (p: { min?: number; max?: number }) => {
      const next = { min: value?.min, max: value?.max, ...p };
      setValue(filter.id, next.min === undefined && next.max === undefined ? null : next);
    };
    return (
      <div className={compact ? s.fcCompact : s.fc}>
        <span className={s.fcLabel}>{label}</span>
        <span className={s.fcRange}>
          <input className={s.input} type="number" placeholder={range ? String(Math.floor(range.min)) : "từ"}
            value={value?.min ?? ""} onChange={(e) => update({ min: num(e.target.value) })} aria-label={`${label}: từ`} />
          <em>–</em>
          <input className={s.input} type="number" placeholder={range ? String(Math.ceil(range.max)) : "đến"}
            value={value?.max ?? ""} onChange={(e) => update({ max: num(e.target.value) })} aria-label={`${label}: đến`} />
        </span>
      </div>
    );
  }

  if (filter.control === "multiselect") {
    const picked = value?.values ?? [];
    const toggle = (v: string) => {
      const next = picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v];
      setValue(filter.id, next.length ? { values: next } : null);
    };
    return (
      <details className={compact ? s.fcCompact : s.fc}>
        <summary className={s.fcSummary}>
          <span className={s.fcLabel}>{label}</span>
          <span className={s.fcValue}>{picked.length ? `${picked.length} đã chọn` : "Tất cả"}</span>
        </summary>
        <div className={s.fcMenu}>
          {options.map((o) => (
            <label key={o} className={s.fcOption}>
              <input type="checkbox" checked={picked.includes(o)} onChange={() => toggle(o)} /> {o}
            </label>
          ))}
          {picked.length > 0 && (
            <button type="button" className={s.fcReset} onClick={() => setValue(filter.id, null)}>Bỏ chọn</button>
          )}
        </div>
      </details>
    );
  }

  return (
    <div className={compact ? s.fcCompact : s.fc}>
      <span className={s.fcLabel}>{label}</span>
      <select className={s.input} value={value?.values?.[0] ?? ""} aria-label={label}
        onChange={(e) => setValue(filter.id, e.target.value ? { values: [e.target.value] } : null)}>
        <option value="">Tất cả</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function FilterCard({ filter }: { filter: Filter }) {
  const widgets = useEditor((st) => st.doc.widgets);
  const mutate = useEditor((st) => st.mutate);
  const setValue = useEditor((st) => st.setFilterValue);
  const pageDoc = useEditor((st) => st.doc);
  const pages = getPages(pageDoc);
  const targetable = widgets.filter((w) => w.config.kind === "chart" || w.config.kind === "kpi");
  const pageTag = (w: (typeof widgets)[number]) =>
    pages.length > 1 ? `${pages.find((p) => p.id === pageIdOf(pageDoc, w))?.name.trim() || "Trang"} · ` : "";
  const scoped = !!filter.targets?.length;

  const patch = (p: Partial<Filter>, key?: string) =>
    mutate((d) => ({ ...d, filters: d.filters.map((f) => (f.id === filter.id ? { ...f, ...p } : f)) }), key);
  const remove = () => {
    mutate((d) => ({ ...d, filters: d.filters.filter((f) => f.id !== filter.id) }));
    setValue(filter.id, null);
  };

  return (
    <div className={s.filterCard}>
      <div className={s.filterCardHead}>
        <strong title={filter.column}>{filter.column}</strong>
        <button className={s.iconBtn} title="Xoá bộ lọc" onClick={remove}><Icon name="trash" size={13} /></button>
      </div>
      <TextField label="Tên hiển thị" value={filter.label ?? ""} placeholder={filter.column}
        onChange={(v) => patch({ label: v || undefined }, `flabel:${filter.id}`)} />
      <SelectField label="Kiểu điều khiển" value={filter.control as (typeof CONTROLS)[number]["value"]}
        options={[...CONTROLS]}
        onChange={(v) => { patch({ control: v }); setValue(filter.id, null); }} />
      {filter.control === "grain" && (
        <>
          <span className={s.label}>Cấp người xem được chọn</span>
          <div className={s.targetList}>
            {ALL_GRAINS.map((g) => {
              const cur = filter.grains?.length ? filter.grains : DEFAULT_GRAINS;
              return (
                <label key={g} className={s.fcOption}>
                  <input type="checkbox" checked={cur.includes(g)}
                    onChange={(e) => {
                      const next = e.target.checked ? ALL_GRAINS.filter((x) => cur.includes(x) || x === g) : cur.filter((x) => x !== g);
                      if (next.length) patch({ grains: next });
                    }} />
                  {GRAIN_LABEL[g]}
                </label>
              );
            })}
          </div>
          <p className={s.hint}>Bộ chọn này không lọc dòng, mà đổi cấp gom của mọi chiều thuộc cột «{filter.column}» (kể cả chiều đang để «Nguyên giá trị»). Người xem chọn «Mặc định» để về cài đặt riêng của từng widget.</p>
        </>
      )}
      <Toggle label="Chỉ áp cho một số widget" value={scoped}
        onChange={(on) => patch({ targets: on ? targetable.map((w) => w.id) : undefined })} />
      {scoped && (
        <div className={s.targetList}>
          {targetable.map((w) => (
            <label key={w.id} className={s.fcOption}>
              <input type="checkbox" checked={filter.targets!.includes(w.id)}
                onChange={(e) => {
                  const cur = filter.targets ?? [];
                  const next = e.target.checked ? [...cur, w.id] : cur.filter((x) => x !== w.id);
                  patch({ targets: next.length ? next : undefined });
                }} />
              {pageTag(w)}{widgetLabel(w)}
            </label>
          ))}
        </div>
      )}
      <div className={s.filterTry}>
        <span className={s.label}>Thử lọc</span>
        <FilterControl filter={filter} />
      </div>
    </div>
  );
}

export function FiltersPanel() {
  const doc = useEditor((st) => st.doc);
  const mutate = useEditor((st) => st.mutate);
  const values = useEditor((st) => st.filterValues);
  const setValue = useEditor((st) => st.setFilterValue);
  const dataVersion = useDataVersion();
  const source = doc.sources[0];
  const used = new Set(doc.filters.filter((f) => f.control !== "grain").map((f) => f.column));
  const grainUsed = new Set(doc.filters.filter((f) => f.control === "grain").map((f) => f.column));
  // Cột gốc + trường tính toán theo dòng (trường tổng hợp không lọc được).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allCols = useMemo(() => (source ? nonAggregateColumns(columnsWithCalc(doc, source.id)) : []), [doc, source, dataVersion]);
  const free = allCols.filter((c) => !used.has(c.name));
  const dateFree = allCols.filter((c) => c.type === "date" && !grainUsed.has(c.name));
  const active = Object.keys(values).length;

  const addGrain = (column: string) => {
    if (!source) return;
    mutate((d) => ({
      ...d,
      filters: [...d.filters, { id: `f_${Math.random().toString(36).slice(2, 9)}`, sourceId: source.id, column, control: "grain", label: "Xem theo" }],
    }));
  };

  const add = (column: string) => {
    if (!source) return;
    const type = allCols.find((c) => c.name === column)?.type;
    mutate((d) => ({
      ...d,
      filters: [
        ...d.filters,
        {
          id: `f_${Math.random().toString(36).slice(2, 9)}`,
          sourceId: source.id,
          column,
          control: type === "number" ? "slider" : type === "date" ? "date_range" : "multiselect",
        },
      ],
    }));
  };

  return (
    <>
      <Section title="Bộ lọc dashboard">
        <p className={s.hint}>
          Bộ lọc áp lên mọi chart, KPI và bảng có cột đó, hoặc chỉ các widget bạn chọn. Khi xem và ở chế độ toàn màn hình,
          bộ lọc hiện ở góc trên để người xem dùng.
        </p>
        {source && free.length > 0 && (
          <select className={s.input} value="" aria-label="Thêm bộ lọc" onChange={(e) => e.target.value && add(e.target.value)}>
            <option value="">+ Thêm bộ lọc theo cột…</option>
            {free.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        )}
        {source && dateFree.length > 0 && (
          <select className={s.input} value="" aria-label="Thêm bộ chọn cấp thời gian" onChange={(e) => e.target.value && addGrain(e.target.value)}>
            <option value="">+ Thêm bộ chọn Ngày/Tuần/Tháng cho cột…</option>
            {dateFree.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        )}
        {!source && <p className={s.hint}>Chưa có nguồn dữ liệu.</p>}
        {active > 0 && (
          <button className={s.addBtn} onClick={() => Object.keys(values).forEach((id) => setValue(id, null))}>
            Bỏ chọn tất cả ({active})
          </button>
        )}
      </Section>
      {doc.filters.map((f) => (
        <Section key={f.id} title="Bộ lọc">
          <FilterCard filter={f} />
        </Section>
      ))}
      {doc.filters.length === 0 && (
        <p className={s.hint} style={{ padding: "0 14px" }}>Chưa có bộ lọc nào. Chọn một cột ở trên để thêm.</p>
      )}
    </>
  );
}
