import type { SupabaseClient } from "@supabase/supabase-js";
import { ORDERS_SPREADSHEET_ID } from "@/lib/orders/canonical";

/** Một nguồn dữ liệu mà người dùng đã chọn cho cuộc trò chuyện. `alias` (s1, s2...) là tên ngắn AI dùng để gọi công cụ (tiết kiệm token, tránh uuid). */
export interface SourceInfo {
  alias: string;
  id: string;
  name: string;
  /** "orders" = nguồn "Đơn hàng đa kênh" đã chuẩn hoá (có báo cáo lãi); "sheet" = Google Sheet thường. */
  kind: "orders" | "sheet";
  columns: { name: string; type: string; unit?: string }[];
  rowCount: number;
  syncedAt: string | null;
  workspaceId: string;
}

export const MAX_SELECTED_SOURCES = 5;

/**
 * Đọc các nguồn người dùng chọn (qua RLS: nguồn không thuộc quyền người dùng bị bỏ qua), giữ thứ tự đã chọn, bỏ trùng.
 * Trả về cả khi chỉ một phần nguồn còn tồn tại (nguồn đã xoá khỏi tài khoản thì biến mất khỏi danh sách).
 */
export async function loadSources(db: SupabaseClient, ids: string[]): Promise<SourceInfo[]> {
  const wanted = [...new Set(ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i)))].slice(0, MAX_SELECTED_SOURCES);
  if (!wanted.length) return [];
  const { data } = await db.from("data_sources").select("id, workspace_id, name, sheet_name, spreadsheet_id, columns, row_count, last_synced_at").in("id", wanted);
  const byId = new Map((data ?? []).map((r) => [r.id as string, r]));
  const out: SourceInfo[] = [];
  for (const id of wanted) {
    const r = byId.get(id);
    if (!r) continue;
    out.push({
      alias: `s${out.length + 1}`,
      id,
      name: ((r.name as string | null) ?? (r.sheet_name as string)) || "Nguồn dữ liệu",
      kind: r.spreadsheet_id === ORDERS_SPREADSHEET_ID ? "orders" : "sheet",
      columns: Array.isArray(r.columns) ? (r.columns as SourceInfo["columns"]) : [],
      rowCount: (r.row_count as number) ?? 0,
      syncedAt: (r.last_synced_at as string | null) ?? null,
      workspaceId: r.workspace_id as string,
    });
  }
  return out;
}

const TYPE_VI: Record<string, string> = { string: "chữ", number: "số", date: "ngày", boolean: "đúng/sai" };

const vn = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "chưa rõ";
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** Cách các cột của nguồn "Đơn hàng đa kênh" nên được hiểu: nếu AI không biết thì sẽ cộng sai (Số đơn ghi ở dòng đầu mỗi đơn...). */
export const ORDERS_SEMANTICS =
  "Đây là dữ liệu ĐÃ KẾT HỢP: đơn của mọi sàn (Shopee, TikTok Shop...) gộp vào một bảng, cột Kênh cho biết sàn, giá vốn/phí sàn/quảng cáo đã được ghép vào đơn. " +
  "Mỗi dòng là một DÒNG SẢN PHẨM của một đơn (một đơn có thể có nhiều dòng). Các cột cấp ĐƠN (Số đơn, Số đơn hủy, Phí sàn, Phí vận chuyển khách trả, Chi phí quảng cáo) chỉ ghi ở dòng đầu của mỗi đơn nên cộng thẳng là đúng. " +
  "Doanh thu gồm cả đơn hủy/hoàn; Doanh thu thực = 0 với đơn hủy/hoàn trả. Giá vốn có thể trống nếu chưa nhập. " +
  "Muốn biết LÃI, phí sàn ước tính, đơn lỗ, sản phẩm lỗ thì dùng công cụ profit_report (đã tính đúng quy tắc của các trang Lãi lỗ), đừng tự trừ các cột. " +
  "NGÀNH HÀNG không phải một cột nhưng LUÔN có cho từng sản phẩm (người bán chọn ở trang Sản phẩm và giá vốn, hoặc Cerno tự nhận diện theo tên): muốn lãi/doanh thu/chi phí theo ngành hàng thì dùng profit_report với group_by=category (category_level 1-3 chọn độ chi tiết, tham số category để xem một ngành).";

/** Mô tả các nguồn đã chọn cho lời nhắc hệ thống: tên cột, kiểu, đơn vị, số dòng, giờ cập nhật. */
export function describeSources(sources: SourceInfo[]): string {
  if (!sources.length) return "(Người dùng chưa chọn nguồn dữ liệu nào.)";
  return sources
    .map((s) => {
      const cols = s.columns.slice(0, 60).map((c) => `${c.name} (${TYPE_VI[c.type] ?? c.type}${c.unit ? `, ${c.unit}` : ""})`).join("; ");
      const head = `${s.alias} = "${s.name}" | ${s.kind === "orders" ? "đơn hàng đã chuẩn hoá của các sàn" : "Google Sheet"} | ${s.rowCount.toLocaleString("vi-VN")} dòng | dữ liệu cập nhật: ${s.syncedAt ? vn(s.syncedAt) : "chưa rõ"}`;
      return `${head}\n  Cột: ${cols || "(chưa có cột)"}${s.kind === "orders" ? `\n  Ý nghĩa: ${ORDERS_SEMANTICS}` : ""}`;
    })
    .join("\n");
}
