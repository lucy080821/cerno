/** Dòng dữ liệu của trang Nguồn dữ liệu (đọc từ bảng data_sources và order_sheets qua RLS). */
export interface SourceRow {
  id: string;
  name: string | null;
  sheet_name: string;
  spreadsheet_id: string;
  columns: { name: string; type: string; unit?: string }[];
  row_count: number;
  last_synced_at: string | null;
  last_error: string | null;
}

export interface OrderSheetRow {
  id: string;
  name: string;
  channel: string;
  sheet_name: string;
  last_synced_at: string | null;
  last_error: string | null;
  line_count: number;
  order_count: number;
  warnings: string[] | null;
}
