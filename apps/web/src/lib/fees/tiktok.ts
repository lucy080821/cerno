import data from "@/content/tiktok-fees.json";
import type { SellerType } from "./constants";
import { buildTable, rateIn, searchIn, type FeeCategory, type Table, type TableEntry } from "./table-core";

/**
 * Biểu Phí Hoa Hồng Nền Tảng theo ngành hàng của TikTok Shop (content/tiktok-fees.json, tạo bằng scripts/import-tiktok-fees.mjs
 * từ file PDF TikTok công bố). CHỈ dùng ở máy chủ. Đường dẫn ngành là "Cấp 1 › Cấp 2 › Cấp 3". Ngành không có trong bảng dùng
 * mức mặc định (`defaultRate`).
 */
const strings = data.strings as string[];
const make = (type: SellerType): Table =>
  buildTable(
    data.effectiveFrom[type],
    data.source,
    (data.rows as number[][]).map(([a, b, c, mall, std]) => ({ parts: [strings[a], strings[b], strings[c]], ratePct: (type === "mall" ? mall : std) / 100 })),
  );

const TABLES: Record<SellerType, Table> = { non_mall: make("non_mall"), mall: make("mall") };

export const categoryList = (type: SellerType): readonly TableEntry[] => TABLES[type].list;
export const tableInfo = (type: SellerType) => ({ effectiveFrom: TABLES[type].effectiveFrom, source: TABLES[type].source, count: TABLES[type].list.length });
export const categoryRate = (type: SellerType, path: string | null | undefined): number | null => rateIn(TABLES[type], path);
export const searchCategories = (type: SellerType, query: string, limit = 20): FeeCategory[] => searchIn(TABLES[type], query, limit);
/** Mức phí mặc định (%) cho ngành không có trong bảng. */
export const defaultRate = (type: SellerType): number => data.defaults[type === "mall" ? "mall" : "standard"] / 100;
