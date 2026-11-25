import { z } from "@dashboard/schema";

/* ------------------------------ kiểm tra tham số ------------------------------ */

export const Filter = z.object({
  column: z.string().min(1).max(100),
  values: z.array(z.string().max(200)).max(200).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});
export type FilterArg = z.infer<typeof Filter>;

export const Metric = z.object({
  column: z.string().max(100).optional(),
  agg: z.enum(["sum", "avg", "count", "min", "max", "count_distinct"]).optional(),
  formula: z.string().max(500).optional(),
  name: z.string().max(80).optional(),
});

export const GroupArg = z.object({ column: z.string().max(100), grain: z.enum(["day", "week", "month", "quarter", "year", "month_of_year", "weekday", "hour", "hour_of_day"]).optional() });
export const QueryArgs = z.object({
  source: z.string().max(100),
  group_by: z.array(GroupArg).max(2).optional(),
  metrics: z.array(Metric).min(1).max(5),
  filters: z.array(Filter).max(8).optional(),
  order_by: z.union([z.string().max(100), z.number()]).optional(),
  order: z.enum(["desc", "asc"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export const ColumnArgs = z.object({ source: z.string().max(100), column: z.string().min(1).max(100) });
export const SampleArgs = z.object({
  source: z.string().max(100),
  columns: z.array(z.string().max(100)).max(10).optional(),
  filters: z.array(Filter).max(8).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});
export const ProfitArgs = z.object({
  source: z.string().max(100),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  channel: z.string().max(60).optional(),
  group_by: z.enum(["none", "channel", "product", "category", "day", "month", "loss_reason"]).optional(),
  /** Cấp ngành hàng khi group_by = category (1 = ngành lớn nhất). */
  category_level: z.number().int().min(1).max(3).optional(),
  /** Chỉ giữ các sản phẩm thuộc ngành này (khớp một phần tên ngành, không phân biệt hoa/dấu) ở bảng chi tiết. */
  category: z.string().max(100).optional(),
  sort: z.enum(["profit_desc", "profit_asc", "revenue_desc"]).optional(),
  limit: z.number().int().min(1).max(30).optional(),
});

