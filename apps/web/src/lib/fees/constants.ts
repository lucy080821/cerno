/**
 * Phí sàn Shopee dùng để ƯỚC TÍNH khi file đơn hàng không có cột phí. Hằng số dùng được cả ở trình duyệt và máy chủ
 * (không import bảng phí theo ngành, bảng đó chỉ nằm ở máy chủ: lib/fees/shopee.ts).
 *
 * Nguồn: các bài trên Shopee Uni (banhang.shopee.vn/edu, bài 251, 25223, 2139, 27540) và file PDF biểu phí ngành hàng. Phí thay đổi
 * theo thời gian: khi Shopee đổi, sửa ở đây và cập nhật content/shopee-fees.json.
 */
export type SellerType = "non_mall" | "mall";

export const SELLER_TYPES: { value: SellerType; label: string }[] = [
  { value: "non_mall", label: "Shop thường (không thuộc Shopee Mall)" },
  { value: "mall", label: "Shopee Mall" },
];

/** Phí Xử Lý Giao Dịch (trước 24/04/2026 gọi là Phí Thanh Toán): 6% (đã gồm GTGT) cho MỌI phương thức thanh toán. */
export const PROCESSING_FEE_PCT = 6;
/** Phí Hạ Tầng: 3.000đ (đã gồm GTGT) mỗi đơn, áp dụng cho đơn tạo từ 01/07/2025. */
export const INFRA_FEE_VND = 3000;
export const INFRA_FEE_FROM = "2025-07-01";
/** Ưu đãi người bán mới (đăng sản phẩm đầu tiên từ 01/01 đến 31/05/2026): giai đoạn giảm Phí Cố Định. */
export const NEW_SELLER_FROM = "2026-06-01";
export const NEW_SELLER_TO = "2026-08-31";
/** Ngưỡng mức phí để chọn cách giảm: từ 6% trở lên trừ 3 điểm phần trăm, dưới 6% giảm một nửa. */
export const NEW_SELLER_THRESHOLD_PCT = 6;
export const NEW_SELLER_CUT_POINTS = 3;

export interface FeeSettings {
  /** Bật ước tính phí sàn khi đơn Shopee không có phí trong file. */
  enabled: boolean;
  sellerType: SellerType;
  /** Người bán mới đủ điều kiện ưu đãi giảm Phí Cố Định. */
  newSeller: boolean;
}

export const DEFAULT_FEE_SETTINGS: FeeSettings = { enabled: false, sellerType: "non_mall", newSeller: false };

export const isSellerType = (v: unknown): v is SellerType => v === "non_mall" || v === "mall";
/** Kênh được ước tính phí. */
export const FEE_CHANNEL = "Shopee";
export const MAX_CATEGORY_LENGTH = 300;

export interface FeePayload {
  /** Phí ship shop chịu (ước tính) theo kênh; available = false khi chưa chạy migration 0020. */
  ship: { available: boolean; rates: Record<string, { perOrder: number; perReturn: number }> };
  available: boolean;
  settings: FeeSettings;
  /** Ngày hiệu lực của biểu phí đang dùng (theo loại shop). */
  tableFrom: string;
  /** costKey(sku) → ngành đã chọn và mức phí hiện hành (null nếu ngành không có trong biểu phí của loại shop này). */
  categories: Record<string, { path: string; ratePct: number | null }>;
}
