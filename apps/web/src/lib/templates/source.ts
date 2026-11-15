import type { ColumnInfo, DataSource } from "@dashboard/schema";
import { isUploadId } from "@/lib/orders/canonical";

/** Phần của một dòng `data_sources` mà việc tạo từ mẫu cần. */
export interface TemplateSource {
  id: string;
  name: string | null;
  sheet_name: string;
  spreadsheet_id: string;
  columns: { name: string; type: string; unit?: string }[];
}

const TYPES = new Set(["string", "number", "date", "boolean"]);
const normType = (t: string): ColumnInfo["type"] => (TYPES.has(t) ? (t as ColumnInfo["type"]) : "string");

/** Cột của nguồn với kiểu đã chuẩn hoá (kiểu lạ coi là chữ). */
export function sourceColumns(s: Pick<TemplateSource, "columns">): ColumnInfo[] {
  return s.columns.map((c) => ({ name: c.name, type: normType(c.type) }));
}

/** Mục nguồn để đưa vào `doc.sources` (cùng dạng editor dùng: Google Sheets hoặc file tải lên). */
export function toDataSource(s: TemplateSource): DataSource {
  if (isUploadId(s.spreadsheet_id)) {
    return { id: s.id, type: "upload", name: s.name ?? s.sheet_name, columns: s.columns.map((c) => ({ name: c.name, type: normType(c.type), ...(c.unit ? { unit: c.unit } : {}) })) };
  }
  return {
    id: s.id,
    type: "google_sheets",
    spreadsheetId: s.spreadsheet_id,
    sheetName: s.name ?? s.sheet_name,
    columns: s.columns.map((c) => ({ name: c.name, type: normType(c.type), ...(c.unit ? { unit: c.unit } : {}) })),
  };
}
