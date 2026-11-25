import type { ToolResult } from "./types";

/** Lỗi do tham số AI gửi sai (cột không có, bộ lọc sai...): trả lại cho AI dạng "LỖI: ..." để nó tự sửa rồi gọi lại. */
export class ToolError extends Error {}
export const fail = (message: string, status: string): ToolResult => ({ ok: false, content: `LỖI: ${message}`, status });

export const r2 = (n: number) => Math.round(n * 100) / 100;
/** Số gọn 2 chữ số thập phân; null/NaN/vô cực thành null (JSON không có NaN). */
export const num = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : r2(n));
