"use client";

import { useMemo, useState } from "react";
import type { ChartConfig, ChartFormat, FieldBinding, KpiCompare, TextStyle, Widget, WidgetConfig } from "@dashboard/schema";
import {
  AGG_LABEL, CHART_SPECS, CHART_TYPE_ORDER, chartColorKeys, chartColorKeysFromTable, chartFields, clampFields, defaultAxisTitles, resolveFormat,
  resolveSeriesColors, FORECAST_DEFAULTS, FORECAST_MAX_PERIODS, forecastGrainOf,
} from "@dashboard/chart-engine";
import { useEditor, type AlignKind } from "@/lib/editor/store";
import { getRows } from "@/lib/editor/sample-data";
import { useData, useDataVersion, useIsRemote } from "@/lib/editor/data-store";
import { calcDefsFor, useRemoteQuery } from "@/lib/editor/remote-query";
import { columnsWithCalc } from "@/lib/editor/calc";
import { widgetLabel } from "@/lib/editor/defaults";
import { ColorField, Icon, NumField, Section, SelectField, TextField, Toggle } from "./fields";
import { SourcesPanel } from "./SourcesPanel";
import { Spinner } from "@/components/Spinner";
import { PageSettings } from "./PageSettings";
import { ImageUpload } from "./ImageUpload";
import s from "./editor.module.css";

const CHART_TYPES = CHART_TYPE_ORDER.map((value) => ({ value, label: CHART_SPECS[value].label }));

/** Đổi loại chart: cắt bớt ô thừa, bổ sung ô còn thiếu bằng cột phù hợp để chart vẽ được ngay. */
function refit(
  type: ChartConfig["chartType"], dims: FieldBinding[], metrics: FieldBinding[],
  columns: Array<{ name: string; type: string; aggregate?: boolean }>,
): { dimensions: FieldBinding[]; metrics: FieldBinding[] } {
  const spec = CHART_SPECS[type];
  const c = clampFields(type, dims, metrics);
  const dimensions = [...c.dims];
  const ms = [...c.metrics];
  if (type === "histogram") {
    // Histogram cần MỘT cột số làm chiều và đếm số dòng.
    const numCols = columns.filter((x) => x.type === "number" && !x.aggregate);
    const col = numCols.find((x) => x.name === dims[0]?.column) ?? numCols[0];
    if (col) return { dimensions: [{ column: col.name }], metrics: [] };
  }
  const free = columns.filter((x) => !x.aggregate && !dimensions.some((d) => d.column === x.name));
  const strings = [...free.filter((x) => x.type === "string"), ...free.filter((x) => x.type === "date")];
  while (dimensions.length < spec.dims[0] && strings.length) dimensions.push({ column: strings.shift()!.name });
  const nums = columns.filter((x) => x.type === "number" && !ms.some((m) => m.column === x.name));
  while (ms.length < spec.metrics[0] && nums.length) ms.push({ column: nums.shift()!.name, aggregation: "sum" });
  return { dimensions, metrics: ms };
}

const AGGS = (Object.keys(AGG_LABEL) as Array<keyof typeof AGG_LABEL>).map((k) => ({ value: k, label: AGG_LABEL[k] }));

const ALIGN: Array<{ kind: AlignKind; label: string }> = [
  { kind: "left", label: "Trái" },
  { kind: "centerX", label: "Giữa ngang" },
  { kind: "right", label: "Phải" },
  { kind: "top", label: "Trên" },
  { kind: "centerY", label: "Giữa dọc" },
  { kind: "bottom", label: "Dưới" },
];

function AlignOrder({ single }: { single: boolean }) {
  const align = useEditor((st) => st.align);
  const reorder = useEditor((st) => st.reorder);
  return (
    <>
      <Section title={single ? "Căn theo canvas" : "Căn đều"}>
        <div className={s.btnGrid}>
          {ALIGN.map((a) => (
            <button key={a.kind} className={s.smallBtn} onClick={() => align(a.kind)}>{a.label}</button>
          ))}
        </div>
      </Section>
      <Section title="Thứ tự lớp">
        <div className={s.btnGrid}>
          <button className={s.smallBtn} onClick={() => reorder("front")}>Lên đầu</button>
          <button className={s.smallBtn} onClick={() => reorder("forward")}>Lên 1</button>
          <button className={s.smallBtn} onClick={() => reorder("backward")}>Xuống 1</button>
          <button className={s.smallBtn} onClick={() => reorder("back")}>Xuống cuối</button>
        </div>
      </Section>
    </>
  );
}

function KpiCompareSection({
  cfg, columns, onChange,
}: {
  cfg: Extract<WidgetConfig, { kind: "kpi" }>;
  columns: Array<{ name: string; type: string; aggregate?: boolean }>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const dateCols = columns.filter((c) => c.type === "date" && !c.aggregate);
  const cmp = cfg.compare;
  const set = (p: Partial<KpiCompare>) => cmp && onChange({ compare: { ...cmp, ...p } });
  return (
    <Section title="So sánh với kỳ khác">
      <Toggle label="Hiện mức tăng/giảm" value={!!cmp}
        onChange={(on) => {
          if (!on) return onChange({ compare: undefined });
          if (!dateCols[0]) return;
          onChange({ compare: { to: "prev_period", dateColumn: dateCols[0].name, grain: "month", show: "percent", goodWhen: "up", toDate: true } });
        }} />
      {!cmp && dateCols.length === 0 && <p className={s.hint}>Nguồn dữ liệu này chưa có cột kiểu ngày nên chưa so sánh kỳ được.</p>}
      {cmp && (
        <>
          <SelectField label="So với" value={cmp.to}
            options={[{ value: "prev_period", label: "Kỳ trước" }, { value: "prev_year", label: "Cùng kỳ năm ngoái" }]}
            onChange={(v) => set({ to: v })} />
          <SelectField label="Cột ngày" value={cmp.dateColumn}
            options={dateCols.map((c) => ({ value: c.name, label: c.name }))}
            onChange={(v) => set({ dateColumn: v })} />
          <SelectField label="Độ dài một kỳ" value={cmp.grain}
            options={[{ value: "day", label: "Ngày" }, { value: "week", label: "Tuần" }, { value: "month", label: "Tháng" }, { value: "quarter", label: "Quý" }, { value: "year", label: "Năm" }]}
            onChange={(v) => set({ grain: v })} />
          <SelectField label="Hiện dạng" value={cmp.show}
            options={[{ value: "percent", label: "% tăng trưởng" }, { value: "diff", label: "Chênh lệch" }, { value: "pp", label: "Chênh lệch điểm % (pp)" }]}
            onChange={(v) => set({ show: v })} />
          <SelectField label="Tăng là" value={cmp.goodWhen}
            options={[{ value: "up", label: "Tốt (xanh)" }, { value: "down", label: "Xấu (đỏ), ví dụ chi phí" }]}
            onChange={(v) => set({ goodWhen: v })} />
          <Toggle label="So cùng số ngày khi kỳ chưa trọn" value={cmp.toDate} onChange={(v) => set({ toDate: v })} />
          <p className={s.hint}>
            Có bộ lọc khoảng ngày trên cột này thì kỳ hiện tại chính là khoảng đó (kỳ trước = khoảng liền kề cùng độ dài).
            Không có thì lấy {cmp.grain === "day" ? "ngày" : cmp.grain === "week" ? "tuần" : cmp.grain === "month" ? "tháng" : cmp.grain === "quarter" ? "quý" : "năm"} chứa
            ngày mới nhất trong dữ liệu. Bộ lọc khoảng ngày trên cột này không làm rỗng kỳ so sánh.
          </p>
        </>
      )}
    </Section>
  );
}

function BindingRow({
  binding, columns, metric, onChange, onRemove, role,
}: {
  /** Vai trò của ô này trong chart (ví dụ "Trục X"), hiện nhỏ phía trên. */
  role?: string;
  binding: FieldBinding;
  columns: Array<{ name: string; type: string; aggregate?: boolean }>;
  metric: boolean;
  onChange: (b: FieldBinding) => void;
  onRemove?: () => void;
}) {
  const cols = metric ? columns : columns;
  return (
    <>
    {role && <span className={s.hint} style={{ margin: "2px 0 -2px" }}>{role}</span>}
    <div className={s.bindingRow}>
      <select className={s.input} value={binding.column}
        onChange={(e) => onChange({ ...binding, column: e.target.value })}>
        {cols.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select>
      {/* Trường tổng hợp (SUM/SUM...) đã tự tính theo nhóm nên không có phép tính để chọn. */}
      {metric && !cols.find((c) => c.name === binding.column)?.aggregate && (
        <select className={s.input} value={binding.aggregation ?? "sum"}
          onChange={(e) => onChange({ ...binding, aggregation: e.target.value as FieldBinding["aggregation"] })}>
          {AGGS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      )}
      {onRemove && (
        <button className={s.iconBtn} title="Bỏ trường" onClick={onRemove}><Icon name="close" size={12} /></button>
      )}
    </div>
    {!metric && cols.find((c) => c.name === binding.column)?.type === "date" && (
      <SelectField label="Gom ngày theo" value={binding.grain ?? ""}
        options={[
          { value: "", label: "Nguyên giá trị" },
          { value: "day", label: "Ngày" },
          { value: "week", label: "Tuần (2025-W36)" },
          { value: "month", label: "Tháng-năm (2025-03)" },
          { value: "quarter", label: "Quý-năm (2025-Q1)" },
          { value: "year", label: "Năm" },
          { value: "month_of_year", label: "Tháng trong năm (gộp mọi năm)" },
          { value: "weekday", label: "Thứ trong tuần" },
          { value: "hour", label: "Ngày + giờ (cột cần có giờ)" },
          { value: "hour_of_day", label: "Giờ trong ngày (gộp mọi ngày)" },
        ]}
        onChange={(v) => onChange({ ...binding, grain: v || undefined })} />
    )}
    </>
  );
}

/** Cột của nguồn kèm trường tính toán; `_version` chỉ để báo dữ liệu/trường đã đổi (không dùng useMemo vì PropertyPanel có return sớm). */
function columnsFor(doc: Parameters<typeof columnsWithCalc>[0], sourceId: string, _version: number) {
  return columnsWithCalc(doc, sourceId);
}

export function PropertyPanel() {
  const [tab, setTab] = useState<"data" | "style">("data");
  const doc = useEditor((st) => st.doc);
  const dataVersion = useDataVersion(); // trường tính toán mới/đổi thì danh sách cột đổi theo
  const selection = useEditor((st) => st.selection);
  const mutate = useEditor((st) => st.mutate);
  const patchWidget = useEditor((st) => st.patchWidget);
  const removeSelected = useEditor((st) => st.removeSelected);
  const duplicateSelected = useEditor((st) => st.duplicateSelected);

  // --- không chọn gì: thuộc tính canvas -------------------------------------
  if (selection.length === 0) {
    const setCanvas = (p: Partial<typeof doc.canvas>, key: string) =>
      mutate((d) => ({ ...d, canvas: { ...d.canvas, ...p } }), key);
    return (
      <div>
        <Section title="Dashboard">
          <TextField label="Tên" value={doc.name} onChange={(v) => mutate((d) => ({ ...d, name: v }), "name")} />
        </Section>
        <Section title="Canvas">
          <div className={s.two}>
            <NumField label="Rộng" value={doc.canvas.width} min={320} max={8000} suffix="px"
              onChange={(v) => setCanvas({ width: v }, "cw")} />
            <NumField label="Cao" value={doc.canvas.height} min={240} max={8000} suffix="px"
              onChange={(v) => setCanvas({ height: v }, "ch")} />
          </div>
          <ColorField label="Màu nền" value={doc.canvas.background}
            onChange={(v) => setCanvas({ background: v ?? "#ffffff" }, "cbg")} />
          <SelectField label="Chủ đề chart" value={doc.theme.mode}
            options={[{ value: "light", label: "Sáng" }, { value: "dark", label: "Tối" }]}
            onChange={(v) => mutate((d) => ({ ...d, theme: { ...d.theme, mode: v } }), "theme")} />
        </Section>
        <PageSettings />
        <Section title="Nguồn dữ liệu">
          <SourcesPanel />
        </Section>
        <p className={s.hint}>
          Chọn một đối tượng để chỉnh thuộc tính. Giữ <kbd>Shift</kbd> để chọn nhiều, giữ <kbd>Space</kbd> và kéo để di chuyển canvas.
        </p>
      </div>
    );
  }

  // --- chọn nhiều ----------------------------------------------------------
  const selected = doc.widgets.filter((w) => selection.includes(w.id));
  if (selected.length > 1) {
    return (
      <div>
        <Section title={`${selected.length} đối tượng`}>
          <div className={s.btnRow}>
            <button className={s.smallBtn} onClick={duplicateSelected}><Icon name="copy" size={13} /> Nhân đôi</button>
            <button className={`${s.smallBtn} ${s.danger}`} onClick={removeSelected}><Icon name="trash" size={13} /> Xoá</button>
          </div>
        </Section>
        <AlignOrder single={false} />
      </div>
    );
  }

  // --- chọn một ------------------------------------------------------------
  const w = selected[0];
  if (!w) return <div />;

  const patch = (p: Partial<Widget>) => patchWidget(w.id, p, Object.keys(p).join(","));
  const patchConfig = (p: Record<string, unknown>) =>
    patchWidget(w.id, (x) => ({ ...x, config: { ...x.config, ...p } as WidgetConfig }), `cfg:${Object.keys(p).join(",")}`);
  const patchStyle = (p: Partial<NonNullable<Widget["style"]>>) =>
    patchWidget(w.id, (x) => ({ ...x, style: { radius: 12, border: false, ...x.style, ...p } }), "style");

  const cfg = w.config;
  const sourceId = cfg.kind === "chart" || cfg.kind === "kpi" ? cfg.sourceId : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const columns = columnsFor(doc, sourceId, dataVersion);

  const dataTab = (
    <>
      {cfg.kind === "chart" && (
        <Section title="Biểu đồ">
          <SelectField label="Loại" value={cfg.chartType as (typeof CHART_TYPES)[number]["value"]}
            options={CHART_TYPES}
            onChange={(t) => {
              // Bảng giữ nguyên ô dữ liệu; các loại khác cắt/bổ sung cho khớp yêu cầu của loại mới.
              patchConfig({ chartType: t, ...(t === "table" ? {} : refit(t, cfg.dimensions, cfg.metrics, columns)) });
            }} />
          <TextField label="Tiêu đề" value={cfg.title ?? ""} onChange={(v) => patchConfig({ title: v })} />
          <ChartBindings cfg={cfg} columns={columns} onChange={patchConfig} />
        </Section>
      )}

      {cfg.kind === "kpi" && (
        <Section title="KPI">
          <TextField label="Tiêu đề" value={cfg.title ?? ""} onChange={(v) => patchConfig({ title: v })} />
          <span className={s.label}>Số đo</span>
          <BindingRow binding={cfg.metric} columns={columns} metric onChange={(b) => patchConfig({ metric: b })} />
        </Section>
      )}

      {cfg.kind === "kpi" && <KpiCompareSection cfg={cfg} columns={columns} onChange={patchConfig} />}

      {cfg.kind === "kpi" && (
        <Section title="Định dạng chữ">
          <Block title="Tiêu đề">
            <TextStyleEditor value={cfg.titleStyle} defaultSize={12.5} canUnderline
              onChange={(v) => patchConfig({ titleStyle: v })} />
          </Block>
          <Block title="Con số">
            <TextStyleEditor value={cfg.valueStyle} defaultSize={Math.round(Math.max(16, Math.min(w.h * 0.38, w.w * 0.2)))}
              defaultBold canUnderline maxSize={300} onChange={(v) => patchConfig({ valueStyle: v })} />
          </Block>
          <SelectField label="Căn lề" value={cfg.align ?? "left"} options={ALIGN_OPTIONS}
            onChange={(v) => patchConfig({ align: v })} />
          <p className={s.hint}>Không đặt cỡ chữ thì con số tự co giãn theo kích thước widget.</p>
        </Section>
      )}

      {cfg.kind === "text" && (
        <>
          <Section title="Nội dung">
            <textarea className={`${s.input} ${s.textarea}`} value={cfg.text}
              onChange={(e) => patchConfig({ text: e.target.value })} />
          </Section>
          <Section title="Định dạng chữ">
            <TextStyleEditor
              value={{ fontFamily: cfg.fontFamily, fontSize: cfg.fontSize, bold: cfg.bold, italic: cfg.italic,
                underline: cfg.underline, color: cfg.color }}
              onChange={(v) => patchConfig({ fontFamily: v.fontFamily, fontSize: v.fontSize ?? cfg.fontSize,
                bold: v.bold ?? cfg.bold, italic: v.italic, underline: v.underline, color: v.color })}
              defaultSize={cfg.fontSize} maxSize={200} canUnderline />
            <SelectField label="Căn lề" value={cfg.align}
              options={[{ value: "left", label: "Trái" }, { value: "center", label: "Giữa" }, { value: "right", label: "Phải" }]}
              onChange={(v) => patchConfig({ align: v })} />
          </Section>
        </>
      )}

      {cfg.kind === "image" && (
        <Section title="Ảnh">
          <ImageUpload url={cfg.url} onUrl={(url) => patchConfig({ url })} />
          <TextField label="Hoặc dán đường dẫn ảnh (URL)" value={cfg.url} placeholder="https://..." onChange={(v) => patchConfig({ url: v })} />
        </Section>
      )}
    </>
  );

  const styleTab = (
    <>
      <Section title="Vị trí và kích thước">
        <div className={s.two}>
          <NumField label="X" value={w.x} onChange={(v) => patch({ x: v })} />
          <NumField label="Y" value={w.y} onChange={(v) => patch({ y: v })} />
          <NumField label="Rộng" value={w.w} min={24} onChange={(v) => patch({ w: Math.max(24, v) })} />
          <NumField label="Cao" value={w.h} min={24} onChange={(v) => patch({ h: Math.max(24, v) })} />
          <NumField label="Xoay" value={w.rotation} step={1} suffix="°" onChange={(v) => patch({ rotation: v })} />
        </div>
        <Toggle label="Khoá vị trí" value={w.locked} onChange={(v) => patch({ locked: v })} />
      </Section>

      {cfg.kind === "chart" && (
        <ChartFormatSection cfg={cfg}
          onChange={(p) => patchWidget(w.id, (x) => x.config.kind === "chart"
            ? { ...x, config: { ...x.config, format: { ...x.config.format, ...p } } }
            : x, "format")} />
      )}

      {cfg.kind === "image" && (
        <Section title="Hiển thị ảnh">
          <SelectField label="Hiển thị" value={cfg.fit}
            options={[{ value: "cover", label: "Phủ kín" }, { value: "contain", label: "Vừa khung" }]}
            onChange={(v) => patchConfig({ fit: v })} />
        </Section>
      )}

      <Section title="Khung">
        <ColorField label="Nền" value={w.style?.background} clearable onChange={(v) => patchStyle({ background: v })} />
        <div className={s.two}>
          <NumField label="Bo góc" value={w.style?.radius ?? 0} min={0} max={200} onChange={(v) => patchStyle({ radius: Math.max(0, v) })} />
        </div>
        <Toggle label="Viền" value={w.style?.border ?? false} onChange={(v) => patchStyle({ border: v })} />
        {w.style?.border && (
          <>
            <NumField label="Độ dày viền" value={w.style?.borderWidth ?? 1} min={0} max={20} suffix="px"
              onChange={(v) => patchStyle({ borderWidth: Math.min(20, Math.max(0, v)) })} />
            <ColorField label="Màu viền" value={w.style?.borderColor} clearable emptyLabel="Mặc định"
              onChange={(v) => patchStyle({ borderColor: v })} />
          </>
        )}
      </Section>

      <AlignOrder single />

      <Section title="Trên điện thoại">
        <Toggle label="Ẩn trên mobile" value={w.mobile?.hidden ?? false}
          onChange={(v) => patchWidget(w.id, (x) => ({ ...x, mobile: { ...x.mobile, hidden: v } }), "mobile")} />
        <p className={s.hint}>Layout mobile tự sinh: xếp một cột, theo thứ tự trên→dưới, trái→phải.</p>
      </Section>
    </>
  );

  return (
    <div>
      <Section title={widgetLabel(w)}>
        <div className={s.btnRow}>
          <button className={s.smallBtn} onClick={duplicateSelected}><Icon name="copy" size={13} /> Nhân đôi</button>
          <button className={`${s.smallBtn} ${s.danger}`} onClick={removeSelected} disabled={w.locked}>
            <Icon name="trash" size={13} /> Xoá
          </button>
        </div>
      </Section>

      <div className={s.tabs} role="tablist">
        <button role="tab" aria-selected={tab === "data"} className={`${s.tab} ${tab === "data" ? s.tabOn : ""}`}
          onClick={() => setTab("data")}>Dữ liệu</button>
        <button role="tab" aria-selected={tab === "style"} className={`${s.tab} ${tab === "style" ? s.tabOn : ""}`}
          onClick={() => setTab("style")}>Kiểu dáng</button>
      </div>

      {tab === "data" ? dataTab : styleTab}
    </div>
  );
}

function ChartBindings({
  cfg, columns, onChange,
}: {
  cfg: ChartConfig;
  columns: Array<{ name: string; type: string; aggregate?: boolean }>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const spec = CHART_SPECS[cfg.chartType];
  const isTable = cfg.chartType === "table";
  const maxDims = spec.dims[1];
  const maxMetrics = spec.metrics[1];
  // Trường tổng hợp chỉ làm được số đo, không làm chiều nhóm.
  const dimCols = columns.filter((c) => !c.aggregate);
  const metricCols = columns;
  const unusedDim = dimCols.find((c) => !cfg.dimensions.some((d) => d.column === c.name));
  const nextMetric = metricCols.find((c) => c.type === "number");

  return (
    <>
      {maxDims > 0 && <span className={s.label}>{isTable ? "Cột nhóm" : "Chiều"}</span>}
      {cfg.dimensions.map((d, i) => (
        <BindingRow key={i} role={isTable ? undefined : spec.dimLabels[i]} binding={d} columns={dimCols} metric={false}
          onChange={(b) => onChange({ dimensions: cfg.dimensions.map((x, j) => (j === i ? b : x)) })}
          onRemove={() => onChange({ dimensions: cfg.dimensions.filter((_, j) => j !== i) })} />
      ))}
      {cfg.dimensions.length < maxDims && unusedDim && (
        <button className={s.addBtn} onClick={() => onChange({ dimensions: [...cfg.dimensions, { column: unusedDim.name }] })}>
          <Icon name="plus" size={12} /> Thêm chiều
        </button>
      )}

      {maxMetrics > 0 && <span className={s.label}>Số đo</span>}
      {maxMetrics > 0 && cfg.metrics.map((m, i) => (
        <BindingRow key={i} role={isTable ? undefined : spec.metricLabels[i]} binding={m} columns={metricCols} metric
          onChange={(b) => onChange({ metrics: cfg.metrics.map((x, j) => (j === i ? b : x)) })}
          onRemove={() => onChange({ metrics: cfg.metrics.filter((_, j) => j !== i) })} />
      ))}
      {cfg.chartType === "scatter" && cfg.metrics.length === 2 && nextMetric && (
        <div className={s.bubbleSlot}>
          <span>{spec.metricLabels[2]}</span>
          <button className={s.addBtn}
            onClick={() => {
              const col = metricCols.find((c) => c.type === "number" && !cfg.metrics.some((m) => m.column === c.name)) ?? nextMetric;
              onChange({ metrics: [...cfg.metrics, { column: col.name, aggregation: "sum" }] });
            }}>
            <Icon name="plus" size={12} /> Thêm kích thước bong bóng
          </button>
        </div>
      )}
      {cfg.chartType !== "scatter" && cfg.metrics.length < maxMetrics && nextMetric && (
        <button className={s.addBtn}
          onClick={() => onChange({ metrics: [...cfg.metrics, { column: nextMetric.name, aggregation: "sum" }] })}>
          <Icon name="plus" size={12} /> Thêm số đo
        </button>
      )}
      {!isTable && spec.hint && <p className={s.hint}>{spec.hint}</p>}
      {!isTable && (cfg.dimensions.length < spec.dims[0] || cfg.metrics.length < spec.metrics[0]) && (
        <p className={s.hint} style={{ color: "#f59e0b" }}>
          Chưa đủ dữ liệu: loại {spec.label} cần {spec.dims[0] > 0 ? `${spec.dims[0]} chiều và ` : ""}ít nhất {spec.metrics[0]} số đo.
        </p>
      )}
    </>
  );
}

const ALIGN_OPTIONS: Array<{ value: "left" | "center" | "right"; label: string }> = [
  { value: "left", label: "Trái" },
  { value: "center", label: "Giữa" },
  { value: "right", label: "Phải" },
];

const FONTS = [
  { value: "", label: "Mặc định" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "'Segoe UI', sans-serif", label: "Segoe UI" },
  { value: "Tahoma, sans-serif", label: "Tahoma" },
  { value: "Verdana, sans-serif", label: "Verdana" },
  { value: "'Trebuchet MS', sans-serif", label: "Trebuchet MS" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "'Courier New', monospace", label: "Courier New" },
];

/** Bộ chỉnh kiểu chữ: font, cỡ, B / I / U, màu. `underline` tắt nếu ECharts không hỗ trợ (nhãn trục, nhãn dữ liệu). */
function TextStyleEditor({
  value, onChange, defaultSize, defaultBold = false, canUnderline, maxSize = 96,
}: {
  value: TextStyle | undefined;
  onChange: (v: TextStyle) => void;
  defaultSize: number;
  defaultBold?: boolean;
  canUnderline: boolean;
  maxSize?: number;
}) {
  const st = value ?? {};
  const set = (p: TextStyle) => onChange({ ...st, ...p });
  const bold = st.bold ?? defaultBold;
  return (
    <>
      <SelectField label="Font" value={st.fontFamily ?? ""} options={FONTS}
        onChange={(v) => set({ fontFamily: v || undefined })} />
      <NumField label="Cỡ chữ" value={st.fontSize ?? defaultSize} min={6} max={maxSize} suffix="px"
        onChange={(v) => set({ fontSize: Math.min(maxSize, Math.max(6, v)) })} />
      <div className={s.fmtRow}>
        <button type="button" title="In đậm" className={`${s.fmtBtn} ${bold ? s.fmtBtnOn : ""}`}
          style={{ fontWeight: 700 }} onClick={() => set({ bold: !bold })}>B</button>
        <button type="button" title="In nghiêng" className={`${s.fmtBtn} ${st.italic ? s.fmtBtnOn : ""}`}
          style={{ fontStyle: "italic" }} onClick={() => set({ italic: !st.italic })}>I</button>
        <button type="button" disabled={!canUnderline}
          title={canUnderline ? "Gạch chân" : "ECharts không hỗ trợ gạch chân cho nhãn này"}
          className={`${s.fmtBtn} ${st.underline ? s.fmtBtnOn : ""}`}
          style={{ textDecoration: "underline" }} onClick={() => set({ underline: !st.underline })}>U</button>
      </div>
      <ColorField label="Màu chữ" value={st.color} clearable emptyLabel="Mặc định" onChange={(v) => set({ color: v })} />
    </>
  );
}

/** Một khối định dạng: tiêu đề khối (có thể kèm công tắc bật/tắt cả khối), nội dung chỉ hiện khi khối đang bật. */
function Block({ title, on, onToggle, children }: {
  title: string; on?: boolean; onToggle?: (v: boolean) => void; children?: React.ReactNode;
}) {
  const enabled = on ?? true;
  return (
    <div className={s.fmtBlock}>
      <div className={s.fmtBlockHead}>
        <span>{title}</span>
        {onToggle && (
          <label className={s.switch} title={enabled ? "Tắt" : "Bật"}>
            <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
            <i />
          </label>
        )}
      </div>
      {enabled && <div className={s.fmtBlockBody}>{children}</div>}
    </div>
  );
}

const MAX_COLOR_ROWS = 12;

function colorTitle(type: ChartConfig["chartType"], slice: boolean): string {
  if (slice) return type === "treemap" ? "Màu từng ô" : type === "funnel" ? "Màu từng tầng" : "Màu từng lát";
  if (type === "radar") return "Màu từng vùng";
  if (type === "gauge") return "Màu đồng hồ";
  if (type === "scatter") return "Màu chấm";
  if (type === "bar" || type === "hbar" || type === "stackedbar") return "Màu từng cột";
  return "Màu từng đường";
}

/** Đổi màu từng cột/đường/vùng (hoặc từng lát với biểu đồ tròn). Lưu theo tên trong format.colors. */
function SeriesColors({ cfg, onChange }: { cfg: ChartConfig; onChange: (p: Partial<ChartFormat>) => void }) {
  const theme = useEditor((st) => st.doc.theme);
  const version = useDataVersion();
  // Nguồn lớn: tên các cột/lát lấy từ bảng server tính (không lọc), vì ở trình duyệt chỉ có dòng mẫu.
  const remote = useIsRemote(cfg.sourceId);
  const calcFields = useEditor((st) => st.doc.calculatedFields);
  const fields = chartFields(cfg);
  const remoteQuery = useRemoteQuery(
    cfg.sourceId,
    remote && fields
      ? { mode: "aggregate", dims: fields.dimensions, metrics: fields.metrics, filters: [], calc: calcDefsFor(calcFields, cfg.sourceId) }
      : null,
  );
  const localKeys = useMemo(
    () => (remote ? [] : chartColorKeys(cfg, getRows(cfg.sourceId), useData.getState().calc[cfg.sourceId])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getRows không reactive: version báo dữ liệu đổi
    [remote, cfg.chartType, cfg.dimensions, cfg.metrics, cfg.sourceId, version],
  );
  const keys = remote
    ? remoteQuery.data?.mode === "aggregate" ? chartColorKeysFromTable(cfg, remoteQuery.data.table) : []
    : localKeys;
  if (remote && remoteQuery.loading && !remoteQuery.data) {
    return <Block title="Màu sắc"><p className={s.hint}><Spinner size={12} inline />Đang tải…</p></Block>;
  }
  if (keys.length === 0) return null;

  const overrides = cfg.format?.colors ?? {};
  const shown = keys.slice(0, MAX_COLOR_ROWS);
  const effective = resolveSeriesColors(keys, theme.palette, overrides);
  const slice = !!CHART_SPECS[cfg.chartType].sliceLike;
  const hasOverride = keys.some((k) => Object.prototype.hasOwnProperty.call(overrides, k));

  const setColor = (key: string, v: string | undefined) => {
    const next = { ...overrides };
    if (v) next[key] = v;
    else delete next[key];
    onChange({ colors: Object.keys(next).length ? next : undefined });
  };

  return (
    <Block title={colorTitle(cfg.chartType, slice)}>
      {shown.map((k, i) => (
        <ColorField key={k} label={k || "(trống)"} value={effective[i]} clearable={Object.prototype.hasOwnProperty.call(overrides, k)}
          onChange={(v) => setColor(k, v)} />
      ))}
      {keys.length > shown.length && (
        <p className={s.hint}>Chỉ hiện {shown.length}/{keys.length} mục đầu. Các mục còn lại dùng màu mặc định.</p>
      )}
      {hasOverride && (
        <button type="button" className={s.smallBtn} onClick={() => onChange({ colors: undefined })}>Đặt lại tất cả màu</button>
      )}
    </Block>
  );
}

/**
 * Ô đổi tên trục. Ô luôn hiện tên đang hiển thị (tên người đặt, nếu chưa đặt thì tên mặc định của chart).
 * Xóa trắng = ẩn tên (lưu chuỗi rỗng); nút "Mặc định" bỏ phần đã đặt.
 */
function AxisTitleField({ label, value, def, onChange }: {
  label: string; value: string | undefined; def: string | undefined; onChange: (v: string | undefined) => void;
}) {
  const shown = value ?? def ?? "";
  return (
    <>
      <TextField label={label} value={shown} placeholder="Không có tên" onChange={(v) => onChange(v)} />
      {value !== undefined && (
        <button type="button" className={s.smallBtn} style={{ marginBottom: 8 }} onClick={() => onChange(undefined)}>
          Mặc định
        </button>
      )}
    </>
  );
}

function ChartFormatSection({ cfg, onChange }: { cfg: ChartConfig; onChange: (p: Partial<ChartFormat>) => void }) {
  const f = resolveFormat(cfg);
  const fmt = cfg.format;
  const spec = CHART_SPECS[cfg.chartType];
  const isGauge = cfg.chartType === "gauge";
  const isHeat = cfg.chartType === "heatmap";
  const isBarLike = cfg.chartType === "bar" || cfg.chartType === "hbar" || cfg.chartType === "stackedbar";

  if (cfg.chartType === "table") {
    return (
      <Section title="Định dạng">
        <Block title="Tiêu đề">
          <TextStyleEditor value={fmt?.title} defaultSize={14} defaultBold canUnderline
            onChange={(v) => onChange({ title: v })} />
          <SelectField label="Căn lề tiêu đề" value={fmt?.titleAlign ?? "left"} options={ALIGN_OPTIONS}
            onChange={(v) => onChange({ titleAlign: v })} />
        </Block>
        <Block title="Hàng tiêu đề cột">
          <TextStyleEditor value={fmt?.tableHeader} defaultSize={12.5} defaultBold canUnderline
            onChange={(v) => onChange({ tableHeader: v })} />
        </Block>
        <Block title="Ô dữ liệu">
          <TextStyleEditor value={fmt?.tableCell} defaultSize={12.5} canUnderline
            onChange={(v) => onChange({ tableCell: v })} />
        </Block>
        <SelectField label="Căn lề chữ trong bảng" value={fmt?.tableAlign ?? ""}
          options={[{ value: "", label: "Tự động (số phải, chữ trái)" }, ...ALIGN_OPTIONS]}
          onChange={(v) => onChange({ tableAlign: v || undefined })} />
      </Section>
    );
  }

  return (
    <Section title="Định dạng">
      <Block title="Tiêu đề">
        <TextStyleEditor value={fmt?.title} defaultSize={14} defaultBold canUnderline
          onChange={(v) => onChange({ title: v })} />
        <SelectField label="Căn lề tiêu đề" value={fmt?.titleAlign ?? "left"} options={ALIGN_OPTIONS}
          onChange={(v) => onChange({ titleAlign: v })} />
      </Block>

      {isGauge && (
        <Block title="Mặt đồng hồ">
          <NumField label="Giá trị tối đa" value={fmt?.gaugeMax ?? 0} min={0} step={1}
            onChange={(v) => onChange({ gaugeMax: v > 0 ? v : undefined })} />
          <p className={s.hint}>Để 0 = tự chọn số tròn lớn hơn giá trị hiện tại.</p>
          <Toggle label="Hiện các mốc số" value={f.showYAxis} onChange={(v) => onChange({ showYAxis: v })} />
          <TextStyleEditor value={fmt?.axis} defaultSize={11} canUnderline={false} onChange={(v) => onChange({ axis: v })} />
        </Block>
      )}

      {cfg.chartType === "histogram" && (
        <Block title="Khoảng chia">
          <NumField label="Số khoảng (bin)" value={fmt?.histBins ?? 10} min={2} step={1}
            onChange={(v) => onChange({ histBins: Math.min(100, Math.max(2, Math.round(v) || 10)) })} />
          <NumField label="Độ rộng mỗi khoảng" value={fmt?.histBinWidth ?? 0} min={0} step={1}
            onChange={(v) => onChange({ histBinWidth: v > 0 ? v : undefined })} />
          <NumField label="Bắt đầu từ" value={fmt?.histBinStart ?? 0} step={1}
            onChange={(v) => onChange({ histBinStart: v })} />
          <button className={s.smallBtn} disabled={fmt?.histBinStart === undefined}
            onClick={() => onChange({ histBinStart: undefined })}>Bắt đầu theo dữ liệu</button>
          <p className={s.hint}>
            Để độ rộng = 0: chia thành tối đa số khoảng trên, độ rộng làm tròn đẹp (1, 2, 5 × 10ⁿ) nên số cột thực tế có thể ít hơn.
            Đặt độ rộng thì dùng đúng giá trị đó và bỏ qua số khoảng. Giá trị nhỏ hơn mốc "Bắt đầu từ" bị bỏ.
          </p>
        </Block>
      )}

      {spec.axes && (
        <Block title="Trục" on={f.showXAxis || f.showYAxis}
          onToggle={(v) => onChange({ showXAxis: v, showYAxis: v })}>
          <Toggle label="Trục X (ngang)" value={f.showXAxis} onChange={(v) => onChange({ showXAxis: v })} />
          <Toggle label="Trục Y (dọc)" value={f.showYAxis} onChange={(v) => onChange({ showYAxis: v })} />
          <TextStyleEditor value={fmt?.axis} defaultSize={12} canUnderline={false}
            onChange={(v) => onChange({ axis: v })} />
        </Block>
      )}

      {spec.axes && (
        <Block title="Tên trục">
          <AxisTitleField label="Tên trục X (ngang)" value={fmt?.xAxisTitle} def={defaultAxisTitles(cfg).x}
            onChange={(v) => onChange({ xAxisTitle: v })} />
          <AxisTitleField label="Tên trục Y (dọc)" value={fmt?.yAxisTitle} def={defaultAxisTitles(cfg).y}
            onChange={(v) => onChange({ yAxisTitle: v })} />
          <p className={s.hint}>Xóa hết chữ để ẩn tên trục. Bấm &quot;Mặc định&quot; để quay lại tên gốc.</p>
        </Block>
      )}

      {spec.axes && !isHeat && (
        <Block title="Đường lưới" on={f.showGrid} onToggle={(v) => onChange({ showGrid: v })} />
      )}

      {spec.axes && !isHeat && cfg.chartType !== "hbar" && (
        <Block title="Đường xu hướng">
          <SelectField label="Kiểu" value={fmt?.trendline ?? "none"}
            options={[
              { value: "none", label: "Không có" },
              { value: "linear", label: "Tuyến tính (hồi quy)" },
              ...(cfg.chartType === "scatter" ? [] : [{ value: "movingAverage" as const, label: "Trung bình trượt" }]),
            ]}
            onChange={(v) => onChange({ trendline: v === "none" ? undefined : v })} />
          {fmt?.trendline === "movingAverage" && cfg.chartType !== "scatter" && (
            <NumField label="Số điểm trung bình" value={fmt.trendWindow ?? 3} min={2} max={60}
              onChange={(v) => onChange({ trendWindow: Math.min(60, Math.max(2, Math.round(v))) })} />
          )}
          {fmt?.trendline && fmt.trendline !== "none" && cfg.chartType === "scatter" && (
            <Toggle label="Hiện phương trình và R²" value={fmt.showTrendInfo ?? false}
              onChange={(v) => onChange({ showTrendInfo: v })} />
          )}
          <p className={s.hint}>
            {cfg.chartType === "scatter"
              ? "Đường thẳng khớp nhất với các điểm. R² càng gần 1 thì các điểm càng nằm sát đường."
              : cfg.chartType === "stackedbar"
                ? "Vẽ một đường nét đứt cho tổng của các phần chồng."
                : "Nét đứt cùng màu với từng đường/cột, thể hiện chiều hướng chung theo thứ tự trục ngang."}
          </p>
        </Block>
      )}

      {(cfg.chartType === "line" || cfg.chartType === "area") && (
        <Block title="Dự báo" on={!!fmt?.forecast}
          onToggle={(v) => onChange({ forecast: v ? {} : undefined })}>
          <NumField label="Số kỳ dự báo" value={fmt?.forecast?.periods ?? FORECAST_DEFAULTS.periods} min={1} max={FORECAST_MAX_PERIODS}
            onChange={(v) => onChange({ forecast: { ...fmt?.forecast, periods: Math.min(FORECAST_MAX_PERIODS, Math.max(1, Math.round(v))) } })} />
          <SelectField label="Phương pháp" value={fmt?.forecast?.method ?? "auto"}
            options={[
              { value: "auto", label: "Tự động (khuyên dùng)" },
              { value: "trend", label: "Chỉ xu hướng (đường thẳng)" },
              { value: "seasonal", label: "Có mùa vụ" },
            ]}
            onChange={(v) => onChange({ forecast: { ...fmt?.forecast, method: v } })} />
          <SelectField label="Mức tin cậy của dải" value={String(fmt?.forecast?.level ?? FORECAST_DEFAULTS.level)}
            options={[
              { value: "0.8", label: "80%" },
              { value: "0.9", label: "90%" },
              { value: "0.95", label: "95%" },
            ]}
            onChange={(v) => onChange({ forecast: { ...fmt?.forecast, level: Number(v) as 0.8 | 0.9 | 0.95 } })} />
          <Toggle label="Hiện dải tin cậy" value={fmt?.forecast?.showBand !== false}
            onChange={(v) => onChange({ forecast: { ...fmt?.forecast, showBand: v } })} />
          <p className={s.hint}>
            {forecastGrainOf(cfg)
              ? "Đường nét đứt là dự báo, dải mờ là khoảng có khả năng xảy ra. Huy hiệu ở góc biểu đồ cho biết sai số khi thử dự báo lại các kỳ gần nhất."
              : "Cần chọn \"Gom ngày theo\" Ngày, Tuần, Tháng, Quý hoặc Năm cho chiều đầu tiên (tab Dữ liệu) thì mới dự báo được."}
          </p>
          <p className={s.hint}>Dự báo chỉ mang tính tham khảo: tính bằng thống kê từ số liệu quá khứ, không biết trước các sự kiện mới.</p>
        </Block>
      )}

      {cfg.chartType === "scatter" && (
        <Block title="Cỡ bong bóng">
          {cfg.metrics.length >= 3 ? (
            <>
              <NumField label="Nhỏ nhất" value={fmt?.bubbleMin ?? 8} min={3} max={60} suffix="px"
                onChange={(v) => onChange({ bubbleMin: Math.min(60, Math.max(3, v)) })} />
              <NumField label="Lớn nhất" value={fmt?.bubbleMax ?? 38} min={6} max={140} suffix="px"
                onChange={(v) => onChange({ bubbleMax: Math.min(140, Math.max(6, v)) })} />
              <p className={s.hint}>Cỡ theo diện tích: giá trị gấp 4 lần thì bong bóng to gấp đôi đường kính.</p>
            </>
          ) : (
            <>
              <NumField label="Cỡ chấm" value={fmt?.pointSize ?? 11} min={3} max={60} suffix="px"
                onChange={(v) => onChange({ pointSize: Math.min(60, Math.max(3, v)) })} />
              <p className={s.hint}>Thêm số đo thứ 3 ở tab Dữ liệu để cỡ mỗi chấm thay đổi theo giá trị (biểu đồ bong bóng).</p>
            </>
          )}
        </Block>
      )}

      {isBarLike && (
        <Block title="Độ rộng cột">
          <NumField label="Rộng" value={fmt?.barWidth ?? 36} min={2} max={200} suffix="px"
            onChange={(v) => onChange({ barWidth: Math.min(200, Math.max(2, v)) })} />
          {fmt?.barWidth !== undefined && (
            <button type="button" className={s.smallBtn} onClick={() => onChange({ barWidth: undefined })}>Tự động</button>
          )}
        </Block>
      )}

      <SeriesColors cfg={cfg} onChange={onChange} />

      {isGauge ? (
        <>
          <Block title="Con số ở giữa">
            <TextStyleEditor value={fmt?.dataLabel} defaultSize={28} defaultBold canUnderline={false}
              onChange={(v) => onChange({ dataLabel: v })} />
          </Block>
          <Block title="Tên số đo">
            <TextStyleEditor value={fmt?.legend} defaultSize={12} canUnderline={false}
              onChange={(v) => onChange({ legend: v })} />
          </Block>
        </>
      ) : (
        <>
          <Block title="Nhãn dữ liệu" on={f.showDataLabels} onToggle={(v) => onChange({ showDataLabels: v })}>
            <TextStyleEditor value={fmt?.dataLabel} defaultSize={12} canUnderline={false}
              onChange={(v) => onChange({ dataLabel: v })} />
          </Block>
          {cfg.chartType !== "scatter" && cfg.chartType !== "treemap" && (
            <Block title={isHeat ? "Thang màu" : "Chú giải"} on={f.showLegend} onToggle={(v) => onChange({ showLegend: v })}>
              <TextStyleEditor value={fmt?.legend} defaultSize={12} canUnderline={false}
                onChange={(v) => onChange({ legend: v })} />
            </Block>
          )}
        </>
      )}

      <p className={s.hint}>Gạch chân chỉ dùng được cho tiêu đề (ECharts không hỗ trợ cho trục, nhãn dữ liệu, chú giải).</p>
    </Section>
  );
}
