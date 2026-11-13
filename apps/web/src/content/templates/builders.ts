/**
 * Hàm dựng widget dùng chung cho các mẫu viết tay (cùng khuôn với `ban-hang.ts`).
 * Tên cột trong mọi tham số là KHOÁ VAI hoặc tên trường tính toán (xem packages/schema/src/template.ts).
 */
export const SRC = "src";

const CARD = { background: "#ffffff", radius: 12, border: true };

export const sum = (column: string, label?: string) => ({ column, aggregation: "sum", label });
export const countDistinct = (column: string, label?: string) => ({ column, aggregation: "count_distinct", label });

export interface KpiCompare {
  dateColumn: string;
  /** Tăng là tốt (mặc định) hay xấu (vd chi phí). */
  goodWhen?: "up" | "down";
}

/** Thẻ KPI ở hàng đầu (y = 90). `slot` = 0..3 là vị trí từ trái sang. */
export const kpi = (id: string, slot: number, title: string, metric: Record<string, unknown>, compare?: KpiCompare) => ({
  id, x: 30 + slot * 355, y: 90, w: 330, h: 120, pageId: "p1",
  style: CARD,
  config: {
    kind: "kpi", sourceId: SRC, title, metric,
    ...(compare
      ? { compare: { to: "prev_period", dateColumn: compare.dateColumn, grain: "month", show: "percent", goodWhen: compare.goodWhen ?? "up", toDate: true } }
      : {}),
  },
});

export const chart = (
  id: string, x: number, y: number, w: number, h: number, chartType: string, title: string,
  dimensions: unknown[], metrics: unknown[],
) => ({
  id, x, y, w, h, pageId: "p1",
  style: CARD,
  config: { kind: "chart", chartType, sourceId: SRC, title, dimensions, metrics },
});

export const titleText = (text: string) => ({
  id: "w-title", x: 30, y: 24, w: 700, h: 48, pageId: "p1",
  config: { kind: "text", text, fontSize: 28, bold: true, align: "left" },
});

/** Bố cục 5 biểu đồ chuẩn dưới hàng KPI: 1 biểu đồ rộng + 1 nhỏ ở trên, 3 biểu đồ ở dưới. */
export const LAYOUT = {
  wide: { x: 30, y: 230, w: 860, h: 320 },
  side: { x: 910, y: 230, w: 500, h: 320 },
  a: { x: 30, y: 570, w: 560, h: 310 },
  b: { x: 610, y: 570, w: 380, h: 310 },
  c: { x: 1010, y: 570, w: 400, h: 310 },
};

/** Trải vị trí của một ô bố cục thành (x, y, w, h) để truyền cho `chart`. */
export const at = (p: { x: number; y: number; w: number; h: number }): [number, number, number, number] => [p.x, p.y, p.w, p.h];

export const canvas ={ width: 1440, height: 900, background: "#f5f7fb" };

/** `YYYY-MM-DD` của ngày thứ `offset` kể từ `start` (tất định, tính theo UTC). */
export function isoDay(start: string, offset: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
