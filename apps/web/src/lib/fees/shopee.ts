import data from "@/content/shopee-fees.json";
import type { SellerType } from "./constants";
import { buildTable, rateIn, searchIn, type FeeCategory, type Table, type TableEntry } from "./table-core";

/**
 * Biểu Phí Cố Định theo ngành hàng của Shopee (content/shopee-fees.json, từ file PDF Shopee công bố). CHỈ dùng ở máy chủ:
 * trình duyệt tìm ngành qua API /api/fees/categories. Đường dẫn ngành là "Cấp 1 › Cấp 2 › Cấp 3" (bỏ cấp trống).
 */
export type { FeeCategory } from "./table-core";

const strings = data.strings as string[];
const make = (t: { effectiveFrom: string; source: string; rows: number[][] }): Table =>
  buildTable(
    t.effectiveFrom,
    t.source,
    t.rows.map(([a, b, c, rate]) => ({ parts: [strings[a], b >= 0 ? strings[b] : "", c >= 0 ? strings[c] : ""].filter(Boolean), ratePct: rate / 100 })),
  );

const TABLES: Record<SellerType, Table> = { non_mall: make(data.nonMall), mall: make(data.mall) };

/** Toàn bộ ngành của biểu phí (dùng để tự nhận diện ngành từ tên sản phẩm, lib/fees/match.ts). Không sửa mảng trả về. */
export const categoryList = (type: SellerType): readonly TableEntry[] => TABLES[type].list;

export const tableInfo = (type: SellerType) => ({ effectiveFrom: TABLES[type].effectiveFrom, source: TABLES[type].source, count: TABLES[type].list.length });

/** Mức Phí Cố Định (%) của một ngành theo đường dẫn; null nếu không có trong biểu phí (vd đổi loại shop khiến tên ngành khác). */
export const categoryRate = (type: SellerType, path: string | null | undefined): number | null => rateIn(TABLES[type], path);

export const searchCategories = (type: SellerType, query: string, limit = 20): FeeCategory[] => searchIn(TABLES[type], query, limit);
