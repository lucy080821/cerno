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
  /** Bật ước tính phí sàn khi đơn Shopee / TikTok Shop không có phí trong file. */
  enabled: boolean;
  /** Loại shop trên Shopee. */
  sellerType: SellerType;
  /** Người bán mới đủ điều kiện ưu đãi giảm Phí Cố Định (Shopee). */
  newSeller: boolean;
  /** Loại shop trên TikTok Shop. */
  tiktokSellerType: SellerType;
  /** Hoa hồng affiliate trung bình (% giá trị sản phẩm) shop trả cho nhà sáng tạo, tính vào phí ước tính của TikTok Shop; 0 = không dùng. */
  tiktokAffiliatePct: number;
}

export const DEFAULT_FEE_SETTINGS: FeeSettings = { enabled: false, sellerType: "non_mall", newSeller: false, tiktokSellerType: "non_mall", tiktokAffiliatePct: 0 };
export const MAX_AFFILIATE_PCT = 50;

/** Các sàn có biểu phí theo ngành để ước tính. Giá trị trùng tên kênh trong dữ liệu đơn hàng. */
export const FEE_PLATFORMS = ["Shopee", "TikTok Shop"] as const;
export type FeePlatform = (typeof FEE_PLATFORMS)[number];
export const isFeePlatform = (v: unknown): v is FeePlatform => v === "Shopee" || v === "TikTok Shop";

/**
 * Phí TikTok Shop (seller-vn.tiktok.com/university, đối chiếu 24/11/2026):
 * - Phí Giao Dịch 6% (đã gồm thuế) × (số tiền khách thanh toán + chiết khấu của nền tảng − phần hoàn tiền), từ 09/05/2026.
 * - Phí Xử Lý Đơn Hàng 3.000đ (đã gồm thuế) mỗi đơn giao thành công, từ 27/10/2025; đơn đã giao rồi hoàn tiền vẫn bị thu.
 * - Phí Hoa Hồng Nền Tảng theo ngành hàng (content/tiktok-fees.json); ngành không có trong bảng dùng mức mặc định.
 */
export const TIKTOK_TRANSACTION_PCT = 6;
export const TIKTOK_PROCESSING_VND = 3000;
export const TIKTOK_PROCESSING_FROM = "2025-10-27";
/** Mức mặc định (%) khi ngành không có trong bảng; trùng với `defaults` của content/tiktok-fees.json (có test). */
export const TIKTOK_DEFAULT_RATE_PCT: Record<SellerType, number> = { non_mall: 14, mall: 16 };
/**
 * Mức Phí Cố Định (%) dùng cho sản phẩm Shopee CHƯA RÕ NGÀNH, để đơn vẫn có phí ước tính thay vì để trống (lãi ảo). Là trung vị của toàn bộ
 * biểu phí theo loại shop (có test đối chiếu với biểu); sản phẩm thật sự cần chính xác thì chọn ngành hoặc để AI phân ngành.
 */
export const SHOPEE_DEFAULT_RATE_PCT: Record<SellerType, number> = { non_mall: 15.5, mall: 18.1 };
/** Mức mặc định (%) của một sàn theo loại shop. */
export const defaultRatePct = (platform: FeePlatform, type: SellerType): number => (platform === "Shopee" ? SHOPEE_DEFAULT_RATE_PCT[type] : TIKTOK_DEFAULT_RATE_PCT[type]);

export const isSellerType = (v: unknown): v is SellerType => v === "non_mall" || v === "mall";
/** Kênh Shopee (tương thích mã cũ). */
export const FEE_CHANNEL = "Shopee";
export const MAX_CATEGORY_LENGTH = 300;

/** Ngành hàng đã chọn / tự nhận diện của một sàn, theo costKey(sku). */
export interface PlatformFeePayload {
  sellerType: SellerType;
  /** Ngày hiệu lực của biểu phí đang dùng (theo loại shop). */
  tableFrom: string;
  /** costKey(sku) → ngành đã chọn và mức phí hiện hành (null nếu ngành không có trong biểu phí của loại shop này). */
  categories: Record<string, { path: string; ratePct: number | null; /** true = AI phân ngành (chưa được người bán xác nhận). */ ai?: boolean }>;
  /** Mức phí (%) áp cho sản phẩm chưa rõ ngành (không có trong `categories` lẫn `suggestions`). */
  defaultRatePct: number;
  /** costKey(sku) → ngành Cerno TỰ NHẬN DIỆN từ tên sản phẩm, chỉ cho sản phẩm chưa được người bán chọn ngành. Cần người bán kiểm tra lại. */
  suggestions: Record<string, { path: string; ratePct: number; source: "alias" | "name" }>;
}

export interface FeePayload {
  /** Phí ship shop chịu (ước tính) theo kênh; available = false khi chưa chạy migration 0020. */
  ship: { available: boolean; rates: Record<string, { perOrder: number; perReturn: number }> };
  /** false khi chưa chạy migration 0018. */
  available: boolean;
  /** true khi đã chạy migration 0021 (ngành theo từng sàn, cài đặt TikTok Shop, phí tự nhập). */
  multiPlatform: boolean;
  settings: FeeSettings;
  platforms: Record<FeePlatform, PlatformFeePayload>;
  /** Phí sàn tự nhập cho các kênh không có biểu phí (Lazada, Tiki...). */
  manual: { available: boolean; rates: Record<string, ManualFeeRate> };
}

/** Phí sàn tự nhập cho một kênh: hoa hồng + phí thanh toán (% giá trị sản phẩm) và phí cố định mỗi đơn. */
export interface ManualFeeRate {
  commissionPct: number;
  paymentPct: number;
  perOrder: number;
}
