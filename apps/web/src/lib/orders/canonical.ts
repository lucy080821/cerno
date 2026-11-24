/**
 * Mô hình "Đơn hàng đa kênh": mọi file xuất từ sàn (Shopee, TikTok Shop...) hay sổ bán hàng tự ghi đều được đưa về
 * CÙNG MỘT bảng cột này, nên một dashboard mẫu chạy được cho mọi kênh. Mỗi dòng là một dòng sản phẩm của một đơn.
 *
 * Các cột tiền và cột đếm theo ĐƠN (Số đơn, Số đơn hủy, Phí sàn, Phí vận chuyển khách trả, Chi phí quảng cáo) chỉ ghi ở dòng
 * đầu tiên của mỗi đơn, vì file của sàn lặp các giá trị cấp đơn ở mọi dòng sản phẩm: cộng thẳng sẽ bị đếm nhiều lần.
 * Giá vốn là tổng giá vốn của dòng sản phẩm và chỉ có với đơn hợp lệ (đơn hủy/hoàn trả: 0, hàng về kho nên không mất vốn).
 *
 * Thông tin người mua (tên, số điện thoại, địa chỉ) KHÔNG bao giờ được đọc: chỉ có tỉnh/thành để xem theo vùng.
 */
import type { ColumnType } from "@/lib/google/sheet-data";

/** Tên và khoá của nguồn: mỗi workspace chỉ có MỘT nguồn này (unique index trên workspace + spreadsheet_id + sheet_name). */
export const ORDERS_SOURCE_NAME = "Đơn hàng đa kênh";
export const ORDERS_SPREADSHEET_ID = "upload:orders";
export const ORDERS_SHEET_NAME = "orders";

/** Nguồn tải lên đánh dấu bằng tiền tố này trong `spreadsheet_id` (cột có sẵn, nên không cần migration và cron đồng bộ chỉ cần loại theo tiền tố). */
export const UPLOAD_ID_PREFIX = "upload:";
export const isUploadId = (spreadsheetId: string | null | undefined): boolean => !!spreadsheetId && spreadsheetId.startsWith(UPLOAD_ID_PREFIX);

/** Kênh bán. "Khác" dành cho sổ bán hàng tự ghi hoặc sàn chưa có trong danh sách. */
export const CHANNELS = ["Shopee", "TikTok Shop", "Lazada", "Tiki", "Facebook", "Khác"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Trạng thái đã chuẩn hoá. Hai trạng thái cuối không tính vào doanh thu thực và số đơn. */
export const STATUSES = ["Hoàn thành", "Chưa hoàn tất", "Đã hủy", "Hoàn trả"] as const;
export type OrderStatus = (typeof STATUSES)[number];
export const isValidStatus = (s: OrderStatus): boolean => s === "Hoàn thành" || s === "Chưa hoàn tất";

export const COL = {
  channel: "Kênh",
  orderId: "Mã đơn",
  date: "Ngày đặt",
  status: "Trạng thái",
  rawStatus: "Trạng thái gốc",
  sku: "SKU",
  product: "Sản phẩm",
  variant: "Phân loại",
  quantity: "Số lượng",
  revenue: "Doanh thu",
  netRevenue: "Doanh thu thực",
  orders: "Số đơn",
  cancelledOrders: "Số đơn hủy",
  platformFee: "Phí sàn",
  province: "Tỉnh/Thành",
  payment: "Thanh toán",
  discount: "Giảm giá",
  shippingFee: "Phí vận chuyển khách trả",
  cost: "Giá vốn",
  adCost: "Chi phí quảng cáo",
} as const;

export interface OrderColumn {
  name: string;
  type: ColumnType;
  unit?: string;
}

/** Thứ tự cột của nguồn. Mọi nguồn "Đơn hàng đa kênh" đều có đủ các cột này, cột không có dữ liệu thì để trống. */
export const ORDER_COLUMNS: OrderColumn[] = [
  { name: COL.channel, type: "string" },
  { name: COL.orderId, type: "string" },
  { name: COL.date, type: "date" },
  { name: COL.status, type: "string" },
  { name: COL.rawStatus, type: "string" },
  { name: COL.sku, type: "string" },
  { name: COL.product, type: "string" },
  { name: COL.variant, type: "string" },
  { name: COL.quantity, type: "number", unit: "cái" },
  { name: COL.revenue, type: "number", unit: "đồng" },
  { name: COL.netRevenue, type: "number", unit: "đồng" },
  { name: COL.orders, type: "number", unit: "đơn" },
  { name: COL.cancelledOrders, type: "number", unit: "đơn" },
  { name: COL.platformFee, type: "number", unit: "đồng" },
  { name: COL.province, type: "string" },
  { name: COL.payment, type: "string" },
  { name: COL.discount, type: "number", unit: "đồng" },
  { name: COL.shippingFee, type: "number", unit: "đồng" },
  { name: COL.cost, type: "number", unit: "đồng" },
  { name: COL.adCost, type: "number", unit: "đồng" },
];

/** Cột trong file người dùng mà việc nhập đọc. Ánh xạ: trường → chỉ số cột trong file (Phí sàn có thể cộng nhiều cột). */
export const INPUT_FIELDS = [
  "orderId",
  "date",
  "status",
  "sku",
  "product",
  "variant",
  "quantity",
  "revenue",
  "unitPrice",
  "platformFee",
  "province",
  "payment",
  "discount",
  "shippingFee",
  "cost",
  "adCost",
] as const;
export type InputField = (typeof INPUT_FIELDS)[number];
export type ColumnMapping = Partial<Record<InputField, number[]>>;

/** Nhãn hiển thị cho người dùng khi chọn cột. */
export const INPUT_LABELS: Record<InputField, string> = {
  orderId: "Mã đơn hàng",
  date: "Ngày đặt hàng",
  status: "Trạng thái đơn",
  sku: "SKU",
  product: "Tên sản phẩm",
  variant: "Phân loại hàng",
  quantity: "Số lượng",
  revenue: "Thành tiền của dòng sản phẩm",
  unitPrice: "Đơn giá (dùng khi không có thành tiền)",
  platformFee: "Phí sàn (cộng các cột phí)",
  province: "Tỉnh/Thành phố",
  payment: "Phương thức thanh toán",
  discount: "Giảm giá của dòng sản phẩm",
  shippingFee: "Phí vận chuyển khách trả (cấp đơn)",
  cost: "Giá vốn của dòng sản phẩm (tổng, không phải đơn giá)",
  adCost: "Chi phí quảng cáo (cấp đơn)",
};

/** Hạn mức một lần tải lên. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_ROWS = 150_000;
export const MAX_FILE_COLUMNS = 200;
