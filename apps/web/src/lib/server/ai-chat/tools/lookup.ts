import type { RowFilter } from "@dashboard/chart-engine";
import { normalizeText } from "@dashboard/schema";
import { isIsoDay } from "@/lib/profit/period";
import type { SourceInfo } from "../sources";
import type { FilterArg } from "./args";
import { ToolError } from "./util";

/* ------------------------------ tra nguồn và cột ------------------------------ */

export function findSource(sources: SourceInfo[], ref: string): SourceInfo {
  const s = sources.find((x) => x.alias === ref.trim().toLowerCase()) ?? sources.find((x) => x.id === ref) ?? sources.find((x) => normalizeText(x.name) === normalizeText(ref));
  if (!s) throw new ToolError(`Không có nguồn "${ref}". Các nguồn đang chọn: ${sources.map((x) => `${x.alias} (${x.name})`).join(", ")}.`);
  return s;
}

/** Tên cột đúng chữ; nếu AI gõ lệch hoa/thường/dấu thì tự sửa; không có thì báo kèm gợi ý để AI thử lại. */
export function findColumn(source: SourceInfo, name: string, extra: string[] = []): string {
  const all = [...source.columns.map((c) => c.name), ...extra];
  if (all.includes(name)) return name;
  const key = normalizeText(name);
  const hit = all.find((c) => normalizeText(c) === key);
  if (hit) return hit;
  throw new ToolError(`Nguồn ${source.alias} không có cột "${name}". Các cột có: ${all.slice(0, 60).join("; ")}.`);
}

export const typeOf = (source: SourceInfo, column: string) => source.columns.find((c) => c.name === column)?.type;

export function toRowFilters(source: SourceInfo, filters: FilterArg[] | undefined): RowFilter[] {
  return (filters ?? []).map((f) => {
    const column = findColumn(source, f.column);
    const type = typeOf(source, column);
    if (f.from !== undefined || f.to !== undefined) {
      if ((f.from && !isIsoDay(f.from)) || (f.to && !isIsoDay(f.to))) throw new ToolError(`Ngày lọc của cột "${column}" phải dạng yyyy-mm-dd.`);
      return { column, values: [], dateRange: { from: f.from, to: f.to } };
    }
    if (f.min !== undefined || f.max !== undefined) {
      if (type !== "number") throw new ToolError(`Cột "${column}" không phải cột số nên không lọc min/max được (kiểu: ${type ?? "chưa rõ"}).`);
      return { column, values: [], range: { min: f.min, max: f.max } };
    }
    if (!f.values?.length) throw new ToolError(`Bộ lọc cột "${column}" cần values, hoặc min/max, hoặc from/to.`);
    return { column, values: f.values };
  });
}
