import type { QueryResult, QuerySpec } from "@dashboard/chart-engine";
import type { Visual } from "@/lib/ai-chat/visual";
import type { OrderProfit, ProductProfit, ProfitSummary } from "@/lib/profit/order-profit";
import type { SourceInfo } from "../sources";

export interface ProfitData {
  /** Đơn trong khoảng ngày đã chọn. */
  orders: OrderProfit[];
  summary: ProfitSummary;
  /** Khoảng ngày của TOÀN BỘ dữ liệu. */
  dataMin: string | null;
  dataMax: string | null;
  /**
   * Ngành hàng của một sản phẩm (người bán đã chọn ở trang Sản phẩm và giá vốn, hoặc Cerno tự nhận diện theo tên); null khi không xác định được.
   * Thiếu hàm này (nguồn không hỗ trợ) thì profit_report không chia được theo ngành.
   */
  category?: (p: Pick<ProductProfit, "key" | "name" | "channels">) => ProductCategory | null;
}

/** Đường dẫn ngành đủ cấp (ngăn cách bằng " › ") kèm cách xác định. */
export interface ProductCategory {
  path: string;
  source: "chosen" | "suggested";
  platform: string;
}

export interface ToolDeps {
  query: (sourceId: string, spec: QuerySpec) => Promise<QueryResult>;
  /** Có khi nguồn đơn hàng được chọn; `range` null = toàn bộ thời gian. */
  profit?: (source: SourceInfo, range: { from: string; to: string } | null) => Promise<ProfitData>;
  /** Ngôn ngữ giao diện: số trên thẻ KPI được định dạng theo kiểu Việt hoặc kiểu Anh. */
  lang?: "vi" | "en";
}

export interface ToolResult {
  ok: boolean;
  /** Nội dung trả cho model (JSON gọn hoặc câu báo lỗi bắt đầu bằng "LỖI"). */
  content: string;
  /** Dòng trạng thái ngắn cho người dùng ("Đang tính doanh thu theo kênh..."). */
  status: string;
  /** Hình (biểu đồ / thẻ KPI) hiện cho người dùng trong tin trả lời; chỉ các công cụ show_* mới có. */
  visual?: Visual;
}
