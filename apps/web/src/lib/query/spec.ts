import { FieldBinding, z } from "@dashboard/schema";
import type { QuerySpec } from "@dashboard/chart-engine";

/**
 * Hình dạng hợp lệ của một truy vấn dữ liệu gửi lên server (xem chart-engine/src/query.ts).
 * Mọi giới hạn ở đây là phòng vệ: server tính trên cả trăm nghìn dòng nên không được để client yêu cầu tuỳ ý.
 */
const text = (n: number) => z.string().max(n);

const RowFilterSchema = z.object({
  column: text(100),
  values: z.array(text(200)).max(1000),
  range: z.object({ min: z.number().finite().optional(), max: z.number().finite().optional() }).optional(),
  dateRange: z.object({ from: text(10).optional(), to: text(10).optional() }).optional(),
  originId: text(100).optional(),
  targets: z.array(text(100)).max(100).optional(),
});

const CalcDefSchema = z.object({ id: text(100), name: text(80), expression: text(1000) });

const filters = z.array(RowFilterSchema).max(40);
const calc = z.array(CalcDefSchema).max(50);

export const QuerySpecSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("aggregate"),
    dims: z.array(FieldBinding).max(3),
    metrics: z.array(FieldBinding).max(6),
    filters,
    selfId: text(100).optional(),
    calc,
  }),
  z.object({ mode: z.literal("raw"), limit: z.number().int().min(1).max(500), filters, selfId: text(100).optional(), calc }),
  z.object({ mode: z.literal("stats"), column: text(100), calc }),
]);

export const QueryRequestSchema = z.object({
  sourceId: z.string().regex(/^[0-9a-f-]{36}$/i),
  spec: QuerySpecSchema,
});

/** Kiểm tra truy vấn từ bên ngoài; trả về null nếu sai hình dạng. */
export const parseQuerySpec = (v: unknown): QuerySpec | null => {
  const r = QuerySpecSchema.safeParse(v);
  return r.success ? (r.data as QuerySpec) : null;
};
