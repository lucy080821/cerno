"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as echarts from "echarts/core";
import { BarChart, FunnelChart, GaugeChart, HeatmapChart, LineChart, PieChart, RadarChart, ScatterChart, TreemapChart } from "echarts/charts";
import { GraphicComponent, GridComponent, LegendComponent, RadarComponent, TitleComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { mobileChartFormat, mobileFontSize, mobileKpiTitleSize, mobileKpiValueSize, type ChartConfig, type TextStyle, type Widget } from "@dashboard/schema";
import { useEditor } from "@/lib/editor/store";
import {
  aggregate,
  applyFilters,
  buildChartOption,
  buildChartOptionFromTable,
  chartFields,
  chartForecastInfo,
  forecastGrainOf,
  chartScrollSize,
  type ForecastInfo,
  formatByKind,
  formatCompactByKind,
  themeColors,
  titleCss,
  computeCompare,
  formatGrowth,
  type AggregatedTable,
  type RowFilter,
  type CalcSet,
  type ChartTheme,
  type QueryResult,
  type Row,
} from "@dashboard/chart-engine";
import { getRows } from "@/lib/editor/sample-data";
import { useData, useDataVersion, useIsRemote } from "@/lib/editor/data-store";
import { calcDefsFor, specForWidget, useRemoteQuery } from "@/lib/editor/remote-query";
import { Spinner } from "@/components/Spinner";
import { useLang } from "@/lib/i18n/store";
import { tr } from "@/lib/i18n";
import { toRowFilters, withGrainOverride } from "@/lib/editor/filters";
import s from "./editor.module.css";

// Chỉ nạp những phần ECharts thực sự dùng, và dùng SVG để chart vẫn nét khi zoom canvas.
echarts.use([
  BarChart, LineChart, PieChart, ScatterChart, TreemapChart, FunnelChart, RadarChart, GaugeChart, HeatmapChart,
  GraphicComponent, GridComponent, LegendComponent, RadarComponent, TitleComponent, TooltipComponent, VisualMapComponent, SVGRenderer,
]);

type EChartsOption = Parameters<ReturnType<typeof echarts.init>["setOption"]>[0];

/**
 * Khi vẽ trong khung điện thoại: chiều rộng nội dung và chiều rộng widget lúc thiết kế trên canvas,
 * để thu cỡ chữ cho vừa màn hình hẹp (xem mobileFontSize trong @dashboard/schema).
 */
export interface MobileCtx {
  screenWidth: number;
  designWidth: number;
}

/** Chuyển TextStyle (chỉ những trường người dùng đã đặt) thành CSS; trường bỏ trống thì giữ mặc định của widget. */
function textCss(st?: TextStyle & { fontSize?: number }): CSSProperties {
  if (!st) return {};
  return {
    ...(st.color ? { color: st.color } : {}),
    ...(st.fontSize ? { fontSize: st.fontSize } : {}),
    ...(st.fontFamily ? { fontFamily: st.fontFamily } : {}),
    ...(st.bold !== undefined ? { fontWeight: st.bold ? 700 : 400 } : {}),
    ...(st.italic ? { fontStyle: "italic" } : {}),
    ...(st.underline ? { textDecoration: "underline" } : {}),
  };
}

/** Khung ngoài của widget (nền, bo góc, viền) dùng chung cho canvas và preview mobile. */
export function frameStyle(w: Widget, theme: ChartTheme): CSSProperties {
  const st = w.style;
  const dark = theme.mode === "dark";
  const width = st?.borderWidth ?? 1;
  const hasBorder = !!st?.border && width > 0;
  const defaultColor = dark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.1)";
  return {
    background: st?.background ?? undefined,
    borderRadius: st?.radius ?? 0,
    border: hasBorder ? `${width}px solid ${st?.borderColor ?? defaultColor}` : undefined,
    // Bóng nhẹ chỉ đi kèm viền mặc định; viền tuỳ chỉnh thì bỏ bóng cho sạch.
    boxShadow: hasBorder && !st?.borderColor && !dark ? "0 1px 2px rgba(15,23,42,0.04)" : undefined,
  };
}

interface PickHandlers {
  /** Bấm vào một cột/lát: `name` là nhãn của dimension đầu. */
  onPick: (name: string, multi: boolean) => void;
  /** Bấm vào vùng trống của chart. */
  onClear: () => void;
}

function ChartView({ option, pick }: { option: Record<string, unknown>; pick?: PickHandlers }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const interactive = !!pick;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: "svg" });
    chartRef.current = chart;
    chart.on("click", (p) => {
      const e = (p.event?.event ?? {}) as MouseEvent;
      if (typeof p.name === "string") pickRef.current?.onPick(p.name, !!(e.shiftKey || e.ctrlKey || e.metaKey));
    });
    chart.getZr().on("click", (e: { target?: unknown }) => {
      if (!e.target) pickRef.current?.onClear();
    });
    const ro = new ResizeObserver(() => {
      try {
        if (!chart.isDisposed()) chart.resize();
      } catch {
        /* container đang bị gỡ khỏi DOM (ví dụ lúc bật/tắt toàn màn hình) */
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chartRef.current = null;
      try {
        if (!chart.isDisposed()) chart.dispose();
      } catch {
        /* ECharts SVG có thể ném lỗi removeChild nếu DOM đã bị gỡ trước */
      }
    };
  }, []);

  useEffect(() => {
    try {
      // Tooltip gắn vào <body> để tràn ra ngoài khung chart/widget (nếu không sẽ bị cắt bởi overflow của khung).
      const t = option.tooltip;
      const withBodyTooltip = t && typeof t === "object" && !Array.isArray(t)
        ? { ...option, tooltip: { ...(t as Record<string, unknown>), appendToBody: true } }
        : option;
      chartRef.current?.setOption(withBodyTooltip as EChartsOption, true);
    } catch (err) {
      // Không để lỗi vẽ của một chart làm sập cả editor.
      console.warn("Không vẽ được chart:", err);
    }
  }, [option]);

  return <div ref={ref} className={s.fill} style={interactive ? { cursor: "pointer" } : undefined} />;
}

const NO_ROWS: Row[] = [];

function Placeholder({ children }: { children: string }) {
  return <div className={s.placeholder}>{children}</div>;
}

/**
 * Biểu đồ tĩnh vẽ từ bảng ĐÃ GỘP có sẵn (dùng trong khung chat AI). Không đọc dữ liệu nguồn, không tương tác chéo.
 * Dùng chủ đề tối vì khung chat tối, bất kể chủ đề của dashboard.
 */
export function StaticChart({ config, table, palette }: {
  config: ChartConfig;
  table: AggregatedTable;
  palette: string[];
}) {
  const theme = useMemo<ChartTheme>(() => ({ palette, mode: "dark" }), [palette]);
  const option = useMemo(() => buildChartOptionFromTable(config, table, theme), [config, table, theme]);
  if (!option) return <Placeholder>Không vẽ được biểu đồ này</Placeholder>;
  return (
    <div className={s.chatChartBody}>
      <ChartView option={option} />
    </div>
  );
}

/** Đang chờ server tính số liệu (nguồn lớn). */
function Loading() {
  return <div className={s.placeholder}><Spinner size={22} label="Đang tính số liệu…" /></div>;
}

/** Ghi chú khi server cắt bớt số nhóm (nguồn lớn, chiều có quá nhiều giá trị khác nhau). */
function TruncNote({ result }: { result: QueryResult | null }) {
  if (result?.mode !== "aggregate" || !result.truncated) return null;
  return (
    <div className={s.truncNote} title="Chiều dữ liệu có quá nhiều giá trị khác nhau, chỉ hiện các giá trị đầu tiên.">
      Hiện {result.table.rows.length.toLocaleString("vi-VN")}/{result.groups.toLocaleString("vi-VN")} nhóm
    </div>
  );
}

function TableView({ widget, rows, theme, calc, remote, useRemote, mobile }: {
  widget: Widget; rows: Row[]; theme: ChartTheme; calc?: CalcSet;
  /** Trên điện thoại: bảng nhiều cột giữ độ rộng tối thiểu mỗi cột và cuộn ngang thay vì bóp chữ. */
  mobile?: MobileCtx;
  /** Nguồn lớn: kết quả do server tính (thay cho `rows`). */
  remote?: QueryResult | null;
  useRemote?: boolean;
}) {
  const cfg = widget.config.kind === "chart" ? widget.config : null;
  const c = themeColors(theme);
  const view = useMemo(() => {
    if (!cfg) return null;
    if (useRemote) {
      if (remote?.mode === "raw") {
        const n = Math.min(8, remote.columns.length);
        return {
          head: remote.columns.slice(0, n),
          body: remote.rows.map((r) => r.slice(0, n)),
          numeric: remote.columns.slice(0, n).map((_, i) => typeof remote.rows[0]?.[i] === "number"),
          cols: remote.columns.slice(0, n) as Array<string | null>,
        };
      }
      if (remote?.mode === "aggregate") {
        const t = remote.table;
        return {
          head: [...t.dimLabels, ...cfg.metrics.map((m) => m.label ?? m.column)],
          body: t.rows.map((r) => [...r.keys, ...r.values]),
          numeric: [...t.dimLabels.map(() => false), ...t.metricLabels.map(() => true)],
          cols: [...cfg.dimensions.map((d) => d.column as string | null), ...t.metricLabels.map(() => null)],
          kinds: [...t.dimLabels.map(() => undefined), ...t.metricLabels.map((_, i) => t.metricKinds?.[i])],
        };
      }
      return null;
    }
    if (cfg.dimensions.length === 0 && cfg.metrics.length === 0) {
      const cols = rows.length ? Object.keys(rows[0]).slice(0, 8) : [];
      return {
        head: cols,
        body: rows.slice(0, 100).map((r) => cols.map((k) => r[k])),
        numeric: cols.map((k) => typeof rows[0]?.[k] === "number"),
        cols: cols as Array<string | null>,
      };
    }
    const t = aggregate(rows, cfg.dimensions, cfg.metrics);
    return {
      // Bảng: tiêu đề cột số liệu chỉ là tên cột (hoặc nhãn người dùng đặt), không kèm "Tổng/Trung bình…".
      head: [...t.dimLabels, ...cfg.metrics.map((m) => m.label ?? m.column)],
      body: t.rows.map((r) => [...r.keys, ...r.values]),
      numeric: [...t.dimLabels.map(() => false), ...t.metricLabels.map(() => true)],
      // Cột chiều dữ liệu bấm được để lọc chéo; cột số liệu thì không.
      cols: [...cfg.dimensions.map((d) => d.column as string | null), ...t.metricLabels.map(() => null)],
      kinds: [...t.dimLabels.map(() => undefined), ...t.metricLabels.map((_, i) => t.metricKinds?.[i])],
    };
  }, [cfg, rows, calc, remote, useRemote]);

  const previewing = useEditor((st) => st.mode === "preview");
  // Khi chỉnh sửa, bảng phải đang được chọn (một mình) thì mới cuộn/sắp xếp được; xem trước thì luôn được.
  const selectedAlone = useEditor((st) => st.selection.length === 1 && st.selection[0] === widget.id);
  const canSort = previewing || selectedAlone;
  const crossFilters = useEditor((st) => st.crossFilters);
  const mine = useMemo(() => crossFilters.filter((f) => f.originId === widget.id), [crossFilters, widget.id]);

  // Sắp xếp: bấm tiêu đề cột (khi xem trước) để xoay vòng tăng → giảm → bỏ sắp xếp.
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const body = useMemo(() => {
    if (!view || !sort || sort.col >= view.head.length) return view?.body ?? [];
    const k = sort.dir === "asc" ? 1 : -1;
    const num = view.numeric[sort.col];
    return [...view.body].sort((a, b) => {
      const x = a[sort.col];
      const y = b[sort.col];
      const xe = x == null || x === "";
      const ye = y == null || y === "";
      if (xe || ye) return xe === ye ? 0 : xe ? 1 : -1; // ô trống luôn xuống cuối
      if (typeof x === "number" && typeof y === "number") return (x - y) * k;
      if (num) return (Number(x) - Number(y)) * k;
      return String(x).localeCompare(String(y), "vi", { numeric: true }) * k;
    });
  }, [view, sort]);
  const clickHead = (i: number) => {
    if (!canSort) return;
    setSort((p) => (!p || p.col !== i ? { col: i, dir: "asc" } : p.dir === "asc" ? { col: i, dir: "desc" } : null));
  };

  if (!cfg || !view) return null;
  const isPicked = (col: string | null, cell: unknown) =>
    !!col && mine.some((f) => f.column === col && f.values.includes(String(cell ?? "")));
  const pickCell = (col: string | null, cell: unknown, e: React.MouseEvent) => {
    if (!previewing || !col) return;
    useEditor.getState().toggleCrossFilter(col, String(cell ?? ""), widget.id, e.shiftKey || e.ctrlKey || e.metaKey);
  };
  return (
    <div className={s.tableWrap} style={{ color: c.text }}>
      {cfg.title && <div className={s.cardTitle} style={{ ...titleCss(cfg, theme), ...(cfg.format?.titleAlign ? { textAlign: cfg.format.titleAlign } : {}) }}>{cfg.title}</div>}
      <div className={s.tableScroll} data-scrollable style={{ ["--tbl-thumb" as string]: theme.mode === "dark" ? "rgba(255,255,255,0.35)" : "rgba(15,23,42,0.35)" }}>
        <table className={s.table} style={mobile ? { minWidth: view.head.length * 96 } : undefined}>
          <thead>
            <tr>
              {view.head.map((h, i) => (
                <th
                  key={h + i}
                  onClick={() => clickHead(i)}
                  aria-sort={sort?.col === i ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  title={canSort ? "Bấm để sắp xếp" : undefined}
                  style={{
                    color: c.muted,
                    textAlign: cfg.format?.tableAlign ?? (view.numeric[i] ? "right" : "left"),
                    borderColor: c.grid,
                    cursor: canSort ? "pointer" : undefined,
                    userSelect: "none",
                    // Tiêu đề dính trên cùng khi cuộn: cần nền đặc để dòng bên dưới không lộ ra.
                    background: widget.style?.background ?? (theme.mode === "dark" ? "#171c2b" : "#ffffff"),
                    ...textCss(cfg.format?.tableHeader),
                  }}
                >
                  {h}
                  {sort?.col === i && <span style={{ marginLeft: 4 }}>{sort.dir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>
                {r.map((cell, ci) => (
                  <td
                    key={ci}
                    onClick={(e) => pickCell(view.cols[ci], cell, e)}
                    style={{
                      ...textCss(cfg.format?.tableCell),
                      textAlign: cfg.format?.tableAlign ?? (view.numeric[ci] ? "right" : "left"),
                      borderColor: c.grid,
                      cursor: previewing && view.cols[ci] ? "pointer" : undefined,
                      background: isPicked(view.cols[ci], cell) ? "rgba(109,94,252,0.16)" : undefined,
                      fontWeight: isPicked(view.cols[ci], cell) ? 600 : undefined,
                    }}
                  >
                    {typeof cell === "number" ? formatByKind(cell, view.kinds?.[ci]) : String(cell ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiView({ widget, rows, allRows, filters, theme, mobile, calc, remote, useRemote }: {
  widget: Widget; rows: Row[]; /** Dòng chưa lọc + bộ lọc đang áp: để tính kỳ so sánh. */ allRows: Row[]; filters: RowFilter[]; theme: ChartTheme; mobile?: MobileCtx; calc?: CalcSet; remote?: QueryResult | null; useRemote?: boolean;
}) {
  const cfg = widget.config.kind === "kpi" ? widget.config : null;
  const c = themeColors(theme);
  const { value, kind } = useMemo(
    () => {
      if (!cfg) return { value: 0, kind: undefined };
      const t = useRemote ? (remote?.mode === "aggregate" ? remote.table : null) : aggregate(rows, [], [cfg.metric], calc);
      return { value: t?.rows[0]?.values[0] ?? 0, kind: t?.metricKinds?.[0] };
    },
    [cfg, rows, calc, remote, useRemote],
  );
  const cmp = cfg?.compare;
  const growth = useMemo(() => {
    if (!cfg || !cmp) return null;
    const res = useRemote
      ? remote?.mode === "aggregate" ? remote.compare ?? null : null
      : computeCompare(allRows, filters, widget.id, cfg.metric, cmp, calc);
    return res ? { ...formatGrowth(res, cmp), label: res.label } : null;
  }, [cfg, cmp, useRemote, remote, allRows, filters, widget.id, calc]);
  if (!cfg) return null;
  const size = Math.max(16, Math.min(widget.h * 0.38, widget.w * 0.2));
  return (
    <div className={s.kpi} style={{ textAlign: cfg.align ?? "left" }}>
      <div
        className={s.kpiTitle}
        style={{ color: c.muted, ...textCss(cfg.titleStyle), ...(mobile ? { fontSize: mobileKpiTitleSize(cfg.titleStyle?.fontSize), marginBottom: 2 } : {}) }}
      >
        {cfg.title ?? ""}
      </div>
      <div
        className={s.kpiValue}
        style={{ color: c.text, fontSize: size, ...textCss(cfg.valueStyle), ...(mobile ? { fontSize: mobileKpiValueSize(widget.h, cfg.valueStyle?.fontSize) } : {}) }}
        title={formatByKind(value, kind)}
      >
        {formatCompactByKind(value, kind)}
      </div>
      {growth && (
        <div
          className={s.kpiGrowth}
          style={{
            fontSize: mobile ? 12 : Math.max(11, Math.min(size * 0.38, 18)),
            justifyContent: cfg.align === "center" ? "center" : cfg.align === "right" ? "flex-end" : "flex-start",
          }}
          title={growth.text ? undefined : "Chưa có dữ liệu kỳ so sánh"}
        >
          {growth.text ? (
            <>
              <span style={{ color: growth.tone === "good" ? "#16a34a" : growth.tone === "bad" ? "#dc2626" : c.muted, fontWeight: 600 }}>
                {growth.dir === "up" ? "▲" : growth.dir === "down" ? "▼" : "▬"} {growth.text}
              </span>
              <span style={{ color: c.muted }}>{growth.label}</span>
            </>
          ) : (
            <span style={{ color: c.muted }}>Chưa có dữ liệu {growth.label.replace("so với ", "")}</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Huy hiệu nhỏ ở góc chart đang bật dự báo: nói thẳng đây là dự báo, sai số kiểm chứng ngược (backtest) bao nhiêu,
 * hoặc vì sao chưa dự báo được. Rê chuột để đọc giải thích đầy đủ.
 */
function ForecastBadge({ info }: { info: ForecastInfo }) {
  const lang = useLang((st) => st.lang);
  // Chuỗi trong `title` (thuộc tính) là một câu ghép nên dịch từng câu rồi mới ghép.
  const t = (text: string) => tr(text, lang);
  if (!info.ok) {
    return (
      <span className={`${s.fcBadge} ${s.fcBadgeOff}`} title={info.failText ? t(info.failText) : undefined}>
        Chưa dự báo được
      </span>
    );
  }
  const err = info.wape === null ? null : info.wape < 0.01 ? "<1" : String(Math.round(info.wape * 100));
  const notes = [
    t(`Dự báo ${info.periods} kỳ tiếp theo bằng phương pháp thống kê. Dải mờ là khoảng tin cậy ${Math.round(info.level * 100)}%.`),
    info.seasonal ? t("Đã tính đến tính mùa vụ của dữ liệu.") : "",
    err === null
      ? t("Chưa đủ dữ liệu để kiểm chứng độ chính xác.")
      : t(`Kiểm chứng ngược: giấu ${info.backtestPoints} kỳ cuối rồi dự báo lại, sai số trung bình ~${err}%.`),
    info.droppedLast ? t("Kỳ cuối chưa trọn nên không dùng để học.") : "",
    info.skipped > 0 ? t(`Chỉ dự báo ${info.seriesCount} đường đầu tiên.`) : "",
    t("Chỉ mang tính tham khảo, không phải cam kết."),
  ].filter(Boolean);
  return (
    <span className={s.fcBadge} title={notes.join(" ")}>
      {err === null ? "Dự báo" : `Dự báo · sai số ~${err}%`}
    </span>
  );
}

function WidgetContentInner({ widget, theme, mobile }: { widget: Widget; theme: ChartTheme; mobile?: MobileCtx }) {
  const cfg = widget.config;
  const sourceId = cfg.kind === "chart" || cfg.kind === "kpi" ? cfg.sourceId : "";
  const dataVersion = useDataVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allRows = useMemo(() => getRows(sourceId), [sourceId, dataVersion]);
  // Trường tính toán dạng tổng hợp của nguồn này (SUM/SUM...), đổi khi người dùng sửa công thức.
  const calc = useData((st) => st.calc[sourceId]);
  // Nguồn lớn (> LOCAL_ROW_LIMIT dòng): server gộp số liệu, trình duyệt chỉ nhận bảng kết quả.
  const isRemote = useIsRemote(sourceId);
  const isSheet = useEditor((st) => !!sourceId && st.doc.sources.find((x) => x.id === sourceId)?.type === "google_sheets");
  const loadStatus = useData((st) => st.status[sourceId]);
  const calcFields = useEditor((st) => st.doc.calculatedFields);

  // Lọc chéo chỉ hoạt động khi xem (Xem trước / Toàn màn hình), vì lúc sửa thì bấm là chọn widget.
  const previewing = useEditor((st) => st.mode === "preview");
  const crossFilters = useEditor((st) => st.crossFilters);
  const dashFilters = useEditor((st) => st.doc.filters);
  const filterValues = useEditor((st) => st.filterValues);
  // Bộ lọc dashboard áp ở mọi chế độ; lọc chéo (bấm vào chart) chỉ áp khi xem.
  const rowFilters = useMemo(() => {
    const rf = toRowFilters(dashFilters, filterValues, sourceId);
    return previewing ? [...rf, ...crossFilters] : rf;
  }, [previewing, crossFilters, dashFilters, filterValues, sourceId]);
  const rows = useMemo(() => {
    if (isRemote) return NO_ROWS; // nguồn lớn: không gộp ở máy
    const rf = toRowFilters(dashFilters, filterValues, sourceId);
    const base = applyFilters(allRows, rf, widget.id);
    return previewing ? applyFilters(base, crossFilters, widget.id) : base;
  }, [isRemote, previewing, allRows, crossFilters, dashFilters, filterValues, sourceId, widget.id]);

  const remoteSpec = useMemo(
    () => (isRemote ? specForWidget(widget, rowFilters, calcDefsFor(calcFields, sourceId)) : null),
    [isRemote, widget, rowFilters, calcFields, sourceId],
  );
  const remote = useRemoteQuery(sourceId, remoteSpec?.spec ?? null);

  // Chart có dimension đầu là cột nào thì bấm vào sẽ lọc theo cột đó.
  // Gauge/heatmap không có "mục" để bấm; treemap 2 tầng bấm vào ô con sẽ không khớp chiều đầu nên cũng tắt.
  const pickable = cfg.kind === "chart" && cfg.chartType !== "table" && cfg.chartType !== "gauge" && cfg.chartType !== "heatmap" &&
    cfg.chartType !== "histogram" && // mỗi cột là một khoảng, không khớp giá trị gốc của cột số
    !cfg.dimensions[0]?.grain && // nhãn "2025-03" không khớp giá trị ngày gốc để lọc
    !(cfg.chartType === "treemap" && cfg.dimensions.length >= 2);
  const pickColumn = pickable && cfg.kind === "chart" ? cfg.dimensions[0]?.column : undefined;
  const highlight = useMemo(
    () => crossFilters.find((f) => f.column === pickColumn && f.originId === widget.id)?.values ?? [],
    [crossFilters, pickColumn, widget.id],
  );
  const pick = useMemo<PickHandlers | undefined>(() => {
    if (!previewing || !pickColumn) return undefined;
    const st = useEditor.getState;
    return {
      onPick: (name, multi) => st().toggleCrossFilter(pickColumn, name, widget.id, multi),
      onClear: () => st().clearCrossFilters(),
    };
  }, [previewing, pickColumn, widget.id]);

  const option = useMemo(() => {
    if (cfg.kind !== "chart" || cfg.chartType === "table") return null;
    if (isRemote) {
      return remote.data?.mode === "aggregate"
        ? buildChartOptionFromTable(cfg, remote.data.table, theme, previewing ? highlight : [])
        : null;
    }
    return buildChartOption(cfg, rows, theme, previewing ? highlight : [], calc);
  }, [cfg, rows, theme, highlight, previewing, calc, isRemote, remote.data]);

  // Huy hiệu dự báo ("Dự báo · sai số ~7%"): chỉ tính khi chart bật dự báo (chạy lại thuật toán trên bảng đã gộp).
  // Chưa bật mà chart đủ điều kiện (đường/vùng, có cấp gom ngày, đủ điểm) thì gợi ý "Thêm dự báo" (chỉ khi đang sửa).
  const forecastState = useMemo(() => {
    if (cfg.kind !== "chart" || (cfg.chartType !== "line" && cfg.chartType !== "area")) return null;
    const enabled = !!cfg.format?.forecast;
    if (!enabled && (previewing || mobile || !forecastGrainOf(cfg))) return null;
    let table: AggregatedTable | null = null;
    if (isRemote) table = remote.data?.mode === "aggregate" ? remote.data.table : null;
    else {
      const f = chartFields(cfg);
      table = f ? aggregate(rows, f.dimensions, f.metrics, calc) : null;
    }
    if (!table) return null;
    if (enabled) return { info: chartForecastInfo(cfg, table), suggest: false };
    const probe = chartForecastInfo({ ...cfg, format: { ...cfg.format, forecast: {} } }, table);
    return probe?.ok ? { info: null, suggest: true } : null;
  }, [cfg, rows, calc, isRemote, remote.data, previewing, mobile]);
  const forecastInfo = forecastState?.info ?? null;
  const suggestForecast = !!forecastState?.suggest && !widget.locked;

  // Nguồn Google Sheets đang tải lần đầu (chưa có dòng nào): hiện vòng quay thay vì khung trống.
  if (isSheet && !isRemote && allRows.length === 0 && (loadStatus === undefined || loadStatus === "loading") && (cfg.kind === "chart" || cfg.kind === "kpi")) {
    return <Loading />;
  }

  // Nguồn lớn: chưa có kết quả thì hiện đang tính / báo lỗi thay vì khung trống.
  const waiting = isRemote && !!remoteSpec && !remote.data;
  if (waiting) {
    return remote.error ? <Placeholder>{`Không tính được số liệu: ${remote.error}`}</Placeholder> : <Loading />;
  }

  switch (cfg.kind) {
    case "chart":
      if (cfg.chartType === "table") {
        return (
          <>
            <TableView widget={widget} rows={rows} theme={theme} calc={calc} remote={remote.data} useRemote={isRemote} mobile={mobile} />
            <TruncNote result={remote.data} />
          </>
        );
      }
      if (!option) return <Placeholder>Chọn trường dữ liệu ở bảng bên phải</Placeholder>;
      // Điện thoại: chart nhiều mục hơn chỗ chứa thì vẽ ở kích thước đủ đọc rồi cho kéo (cuộn) thay vì bóp nhỏ.
      const scroll = mobile ? chartScrollSize(cfg.chartType, option, widget.w, widget.h - (cfg.title ? 34 : 0)) : null;
      return (
        <div className={s.chartCol}>
          {cfg.title && <div className={s.chartTitle} style={{ ...titleCss(cfg, theme), ...(cfg.format?.titleAlign ? { textAlign: cfg.format.titleAlign } : {}) }}>{cfg.title}</div>}
          <div className={s.chartBody}>
            {scroll ? (
              <div
                className={`${s.chartScroll} ${scroll.w && scroll.h ? s.chartScrollBoth : scroll.h ? s.chartScrollY : s.chartScrollX}`}
                role="group"
                aria-label="Biểu đồ có thể cuộn để xem thêm"
              >
                <div style={{ position: "relative", width: scroll.w ?? "100%", height: scroll.h ?? "100%" }}>
                  <ChartView option={option} pick={pick} />
                </div>
              </div>
            ) : (
              <ChartView option={option} pick={pick} />
            )}
          </div>
          <TruncNote result={remote.data} />
          {forecastInfo && <ForecastBadge info={forecastInfo} />}
          {suggestForecast && (
            <button
              type="button"
              className={`${s.fcBadge} ${s.fcSuggest}`}
              title="Vẽ thêm đường dự báo và dải tin cậy cho biểu đồ này"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                useEditor.getState().patchWidget(widget.id, (x) =>
                  x.config.kind === "chart" ? { ...x, config: { ...x.config, format: { ...x.config.format, forecast: {} } } } : x,
                );
              }}
            >
              ✨ Thêm dự báo
            </button>
          )}
          {remote.loading && <span className={s.remoteBusy}><Spinner size={12} /></span>}
        </div>
      );
    case "kpi":
      return <KpiView widget={widget} rows={rows} allRows={allRows} filters={rowFilters} theme={theme} mobile={mobile} calc={calc} remote={remote.data} useRemote={isRemote} />;
    case "text":
      return (
        <div
          className={s.text}
          style={{
            fontSize: mobile ? mobileFontSize(cfg.fontSize, mobile.designWidth, mobile.screenWidth) : cfg.fontSize,
            fontWeight: cfg.bold ? 700 : 400,
            fontStyle: cfg.italic ? "italic" : "normal",
            textDecoration: cfg.underline ? "underline" : "none",
            ...(cfg.fontFamily ? { fontFamily: cfg.fontFamily } : {}),
            textAlign: cfg.align,
            color: cfg.color ?? themeColors(theme).text,
          }}
        >
          {cfg.text}
        </div>
      );
    case "image":
      return cfg.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cfg.url} alt="" className={s.fill} style={{ objectFit: mobile ? "contain" : cfg.fit }} draggable={false} />
      ) : (
        <Placeholder>Tải ảnh lên ở bảng bên phải</Placeholder>
      );
  }
}

/** Vỏ ngoài: trên mobile thì hạ cỡ chữ của biểu đồ/bảng trước khi vẽ (xem mobileChartFormat). */
function WidgetContentRoot(props: { widget: Widget; theme: ChartTheme; mobile?: MobileCtx }) {
  const { widget } = props;
  const isMobile = !!props.mobile;
  // Bộ chọn cấp thời gian của người xem (Ngày/Tuần/Tháng…) đổi grain của chiều ngày trước khi vẽ.
  const dashFilters = useEditor((st) => st.doc.filters);
  const filterValues = useEditor((st) => st.filterValues);
  const shown = useMemo(() => {
    const w = withGrainOverride(widget, dashFilters, filterValues);
    return isMobile && w.config.kind === "chart"
      ? { ...w, config: { ...w.config, format: mobileChartFormat(w.config.format) } }
      : w;
  }, [widget, isMobile, dashFilters, filterValues]);
  return <WidgetContentInner {...props} widget={shown} />;
}

export const WidgetContent = memo(WidgetContentRoot);
