import { CHART_SPECS } from "@dashboard/chart-engine";
import { getPages, pageIdOf, type Dashboard, type Widget } from "@dashboard/schema";

const clip = (s: string, n = 28) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Loại widget bằng tiếng Việt, vd "Biểu đồ cột", "Bảng", "KPI". */
function kindLabel(w: Widget): string {
  const c = w.config;
  if (c.kind === "kpi") return "KPI";
  if (c.kind === "text") return "Văn bản";
  if (c.kind === "image") return "Ảnh";
  if (c.chartType === "table") return "Bảng";
  const l = CHART_SPECS[c.chartType]?.label ?? "";
  return `Biểu đồ ${l.toLowerCase()}`.trim();
}

/**
 * Tên dễ nhận biết cho từng widget để chọn/hiển thị trong bình luận: "Biểu đồ cột: Doanh thu theo tháng".
 * Widget không có tiêu đề thì đánh số theo loại ("Biểu đồ cột 2"); dashboard nhiều trang thì thêm tên trang.
 */
export function widgetLabels(doc: Pick<Dashboard, "widgets" | "pages">): Map<string, string> {
  const pages = getPages(doc);
  const multi = pages.length > 1;
  const pageName = new Map(pages.map((p) => [p.id, p.name || "Trang"]));
  const count = new Map<string, number>();
  const out = new Map<string, string>();
  for (const w of doc.widgets) {
    const kind = kindLabel(w);
    const n = (count.get(kind) ?? 0) + 1;
    count.set(kind, n);
    const c = w.config;
    const own = c.kind === "text" ? c.text : c.kind === "image" ? "" : (c.title ?? "");
    let label = own.trim() ? `${kind}: ${clip(own)}` : `${kind} ${n}`;
    if (multi) label += ` · ${pageName.get(pageIdOf(doc, w)) ?? ""}`;
    out.set(w.id, label);
  }
  return out;
}
