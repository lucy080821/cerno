import type { FeePlatform, SellerType } from "./constants";
import * as shopee from "./shopee";
import * as tiktok from "./tiktok";
import type { FeeCategory, TableEntry } from "./table-core";

/** Tra biểu phí theo sàn (CHỈ máy chủ). */
const T = { Shopee: shopee, "TikTok Shop": tiktok } as const;

export const categoryList = (p: FeePlatform, type: SellerType): readonly TableEntry[] => T[p].categoryList(type);
export const categoryRate = (p: FeePlatform, type: SellerType, path: string | null | undefined): number | null => T[p].categoryRate(type, path);
export const searchCategories = (p: FeePlatform, type: SellerType, q: string, limit = 20): FeeCategory[] => T[p].searchCategories(type, q, limit);
export const tableInfo = (p: FeePlatform, type: SellerType) => T[p].tableInfo(type);
export type { FeeCategory };
