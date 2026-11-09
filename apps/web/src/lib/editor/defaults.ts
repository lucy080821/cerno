import { DEFAULT_NAV, type Dashboard, type DataSource, type Widget, type WidgetConfig } from "@dashboard/schema";
import { CHART_SPECS } from "@dashboard/chart-engine";
import { SAMPLE_SOURCE, SAMPLE_SOURCE_ID } from "./sample-data";

type ChartKind = Extract<WidgetConfig, { kind: "chart" }>["chartType"];
export type NewWidgetKind = ChartKind | "kpi" | "text" | "image";

export const NEW_WIDGET_LABEL: Record<NewWidgetKind, string> = {
  ...(Object.fromEntries(Object.entries(CHART_SPECS).map(([k, v]) => [k, v.label])) as Record<ChartKind, string>),
  kpi: "KPI",
  text: "Văn bản",
  image: "Ảnh",
};

export function newId(): string {
  return `w_${Math.random().toString(36).slice(2, 9)}`;
}

const CARD = { background: "#ffffff", radius: 12, border: true } as const;

type Cols = DataSource["columns"];
type Metric = { column: string; aggregation: "sum" | "count" | "avg" | "count_distinct" };

/**
 * Chọn cột mặc định cho widget mới từ một nguồn bất kỳ: chiều = cột chữ đầu tiên (hoặc ngày),
 * số đo = cột số đầu tiên (tổng), nếu không có cột số thì đếm dòng.
 */
export function smartFields(cols: Cols, kind: NewWidgetKind) {
  const firstString = cols.find((c) => c.type === "string");
  const firstDate = cols.find((c) => c.type === "date");
  // Đường/vùng hợp với trục thời gian; còn lại hợp với cột phân loại.
  const dim = (kind === "line" || kind === "area" ? firstDate ?? firstString : firstString ?? firstDate) ?? cols[0];
  const nums = cols.filter((c) => c.type === "number");
  const metricOf = (c?: Cols[number]): Metric =>
    c ? { column: c.name, aggregation: "sum" } : { column: dim?.name ?? "", aggregation: "count" };
  // Chiều thứ hai (heatmap, treemap...): cột phân loại/ngày khác với chiều đầu.
  const dim2 = [...cols.filter((c) => c.type === "string"), ...cols.filter((c) => c.type === "date")].find((c) => c.name !== dim?.name);
  return { dim, dim2, nums, metric: metricOf(nums[0]), metric2: nums[1] ? metricOf(nums[1]) : undefined, metricOf };
}

const metricName = (m: { column: string; aggregation: string }) => (m.aggregation === "count" ? "Số dòng" : m.column);

export function createWidget(
  kind: NewWidgetKind,
  at: { x: number; y: number },
  sourceId = SAMPLE_SOURCE_ID,
  columns?: Cols,
): Widget {
  const real = sourceId !== SAMPLE_SOURCE_ID && !!columns?.length ? smartFields(columns, kind) : null;
  const base = {
    id: newId(),
    x: Math.round(at.x),
    y: Math.round(at.y),
    rotation: 0,
    z: 0,
    locked: false,
    hidden: false,
  };

  if (kind !== "table" && kind !== "kpi" && kind !== "text" && kind !== "image") return createChart(kind, base, sourceId, real);
  return createOther(kind, base, sourceId, real);
}

type Base = Pick<Widget, "id" | "x" | "y" | "rotation" | "z" | "locked" | "hidden">;
type Real = ReturnType<typeof smartFields> | null;

/** Chart ngoài bảng: ô dữ liệu mặc định lấy theo vai trò của từng loại (xem CHART_SPECS). */
function createChart(kind: Exclude<ChartKind, "table">, base: Base, sourceId: string, real: Real): Widget {
  const SAMPLE_M = (column: string) => ({ column, aggregation: "sum" as const });
  const sizes: Partial<Record<ChartKind, [number, number]>> = {
    pie: [320, 300], funnel: [320, 300], treemap: [380, 300], radar: [360, 320], gauge: [280, 240], scatter: [420, 300], heatmap: [460, 300],
  };
  const [w, h] = sizes[kind] ?? [420, 280];

  let dimensions: Array<{ column: string }> = [];
  let metrics: Metric[] = [];
  let title = "";

  if (real) {
    const d = real.dim?.name ?? "";
    const m = real.metric;
    const label = metricName(m);
    switch (kind) {
      case "scatter":
        dimensions = [{ column: d }];
        metrics = [m, real.metric2 ?? { column: d, aggregation: "count" }];
        // Có từ 3 cột số trở lên thì thêm luôn số đo thứ 3 làm kích thước bong bóng.
        if (real.nums[2]) metrics.push(real.metricOf(real.nums[2]));
        title = `${metricName(metrics[0])} và ${metricName(metrics[1])} theo ${d}`;
        break;
      case "radar": {
        dimensions = [{ column: d }];
        const picks: Metric[] = real.nums.slice(0, 5).map((c) => real.metricOf(c));
        const pad: Metric[] = [
          { column: d, aggregation: "count" },
          { column: d, aggregation: "count_distinct" },
          ...(real.nums[0] ? [{ column: real.nums[0].name, aggregation: "avg" as const }] : []),
        ];
        while (picks.length < 3 && pad.length) picks.push(pad.shift()!);
        metrics = picks;
        title = `So sánh theo ${d}`;
        break;
      }
      case "gauge":
        metrics = [m];
        title = label;
        break;
      case "heatmap":
        dimensions = [{ column: d }, ...(real.dim2 ? [{ column: real.dim2.name }] : [])];
        metrics = [m];
        title = `${label} theo ${d}${real.dim2 ? ` và ${real.dim2.name}` : ""}`;
        break;
      case "treemap":
        dimensions = [{ column: d }];
        metrics = [m];
        title = `${label} theo ${d}`;
        break;
      case "histogram": {
        const col = real.nums[0]?.name ?? d;
        dimensions = [{ column: col }];
        metrics = [];
        title = `Phân phối ${col}`;
        break;
      }
      default:
        dimensions = [{ column: d }];
        metrics = [m];
        title = `${label} theo ${d}`;
    }
  } else {
    switch (kind) {
      case "scatter":
        dimensions = [{ column: "Khu vực" }];
        metrics = [SAMPLE_M("Đơn hàng"), SAMPLE_M("Doanh thu"), SAMPLE_M("Lượt truy cập")];
        title = "Đơn hàng và doanh thu theo khu vực";
        break;
      case "radar":
        dimensions = [{ column: "Khu vực" }];
        metrics = [SAMPLE_M("Doanh thu"), SAMPLE_M("Đơn hàng"), SAMPLE_M("Lượt truy cập")];
        title = "So sánh các khu vực";
        break;
      case "gauge":
        metrics = [SAMPLE_M("Đơn hàng")];
        title = "Tổng đơn hàng";
        break;
      case "heatmap":
        dimensions = [{ column: "Tháng" }, { column: "Kênh" }];
        metrics = [SAMPLE_M("Doanh thu")];
        title = "Doanh thu theo tháng và kênh";
        break;
      case "histogram":
        dimensions = [{ column: "Doanh thu" }];
        metrics = [];
        title = "Phân phối doanh thu";
        break;
      case "funnel":
        dimensions = [{ column: "Kênh" }];
        metrics = [SAMPLE_M("Lượt truy cập")];
        title = "Lượt truy cập theo kênh";
        break;
      case "treemap":
        dimensions = [{ column: "Khu vực" }];
        metrics = [SAMPLE_M("Doanh thu")];
        title = "Doanh thu theo khu vực";
        break;
      case "pie":
        dimensions = [{ column: "Kênh" }];
        metrics = [SAMPLE_M("Doanh thu")];
        title = "Doanh thu theo kênh";
        break;
      default:
        dimensions = [{ column: "Tháng" }];
        metrics = [SAMPLE_M("Doanh thu")];
        title = "Doanh thu theo tháng";
    }
  }
  return {
    ...base, w, h, style: { ...CARD },
    config: { kind: "chart", chartType: kind, sourceId, title, dimensions, metrics },
  };
}

function createOther(kind: NewWidgetKind, base: Base, sourceId: string, real: Real): Widget {
  switch (kind) {
    case "table":
      return {
        ...base, w: 480, h: 240, style: { ...CARD },
        config: {
          kind: "chart", chartType: "table", sourceId,
          title: real ? `Theo ${real.dim.name}` : "Theo khu vực",
          dimensions: [{ column: real ? real.dim.name : "Khu vực" }],
          metrics: real
            ? [real.metric, ...(real.metric2 ? [real.metric2] : [])]
            : [
                { column: "Doanh thu", aggregation: "sum" },
                { column: "Đơn hàng", aggregation: "sum" },
              ],
        },
      };
    case "kpi":
      return {
        ...base, w: 220, h: 110, style: { ...CARD },
        config: {
          kind: "kpi", sourceId,
          title: real ? (real.metric.aggregation === "count" ? "Số dòng" : `Tổng ${real.metric.column}`) : "Tổng doanh thu",
          metric: real ? real.metric : { column: "Doanh thu", aggregation: "sum" },
          compareToPrevious: false,
        },
      };
    case "text":
      return {
        ...base, w: 360, h: 56,
        config: { kind: "text", text: "Tiêu đề dashboard", fontSize: 28, bold: true, align: "left" },
      };
    case "image":
      return {
        ...base, w: 240, h: 160, style: { radius: 12, border: false },
        config: { kind: "image", url: "", fit: "cover" },
      };
    default:
      // Các loại chart khác đi qua createChart.
      throw new Error(`createOther không xử lý loại ${kind}`);
  }
}

export function widgetLabel(w: Widget): string {
  const c: WidgetConfig = w.config;
  switch (c.kind) {
    case "chart":
      return c.title || `Biểu đồ ${NEW_WIDGET_LABEL[c.chartType as NewWidgetKind] ?? c.chartType}`;
    case "kpi":
      return c.title || "KPI";
    case "text":
      return c.text.split("\n")[0].slice(0, 28) || "Văn bản";
    case "image":
      return "Ảnh";
  }
}

export function createBlankDashboard(): Dashboard {
  return {
    schemaVersion: 1,
    id: `d_${Math.random().toString(36).slice(2, 9)}`,
    name: "Dashboard chưa đặt tên",
    canvas: { width: 1440, height: 900, background: "#f1f4f9" },
    theme: { palette: [], mode: "light" },
    sources: [SAMPLE_SOURCE],
    filters: [],
    calculatedFields: [],
    pages: [],
    nav: DEFAULT_NAV,
    widgets: [],
  };
}

/** Dashboard mẫu để editor không trống khi mở lần đầu. */
export function createDemoDashboard(): Dashboard {
  const d = createBlankDashboard();
  d.id = "demo";
  d.name = "Báo cáo bán hàng 2025";

  const at = (kind: NewWidgetKind, x: number, y: number, w: number, h: number, patch?: (w: Widget) => void) => {
    const widget = createWidget(kind, { x, y });
    widget.w = w;
    widget.h = h;
    patch?.(widget);
    return widget;
  };
  const chart = (w: Widget) => w.config as Extract<WidgetConfig, { kind: "chart" }>;
  const kpi = (w: Widget) => w.config as Extract<WidgetConfig, { kind: "kpi" }>;

  d.widgets = [
    at("text", 40, 28, 700, 56, (w) => {
      if (w.config.kind === "text") w.config.text = "Báo cáo bán hàng 2025";
    }),
    at("kpi", 40, 100, 220, 110),
    at("kpi", 276, 100, 220, 110, (w) => {
      kpi(w).title = "Tổng đơn hàng";
      kpi(w).metric = { column: "Đơn hàng", aggregation: "sum" };
    }),
    at("kpi", 512, 100, 228, 110, (w) => {
      kpi(w).title = "Lượt truy cập";
      kpi(w).metric = { column: "Lượt truy cập", aggregation: "sum" };
    }),
    at("bar", 40, 230, 700, 310, (w) => {
      chart(w).dimensions = [{ column: "Tháng" }, { column: "Kênh" }];
    }),
    at("area", 760, 100, 640, 300, (w) => {
      chart(w).title = "Lượt truy cập theo tháng";
      chart(w).metrics = [{ column: "Lượt truy cập", aggregation: "sum" }];
    }),
    at("pie", 760, 420, 310, 320),
    at("line", 1090, 420, 310, 320, (w) => {
      chart(w).title = "Đơn hàng theo tháng";
      chart(w).metrics = [{ column: "Đơn hàng", aggregation: "sum" }];
    }),
    at("table", 40, 560, 700, 280, (w) => {
      chart(w).title = "Hiệu suất theo khu vực";
    }),
  ];
  d.widgets.forEach((w, i) => (w.z = i));
  return d;
}
