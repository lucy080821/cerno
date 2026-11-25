import {
  INFRA_FEE_FROM, INFRA_FEE_VND, NEW_SELLER_CUT_POINTS, NEW_SELLER_FROM, NEW_SELLER_THRESHOLD_PCT, NEW_SELLER_TO, PROCESSING_FEE_PCT,
  TIKTOK_DEFAULT_RATE_PCT, TIKTOK_PROCESSING_FROM, TIKTOK_PROCESSING_VND, TIKTOK_TRANSACTION_PCT,
  type FeeSettings, type ManualFeeRate,
} from "./constants";

/** Ước tính phí sàn Shopee của một đơn. Hàm thuần, có test. Kết quả chỉ là ƯỚC TÍNH, giao diện phải nói rõ. */

export interface FeeLineInput {
  /** Giá trị dòng trước khi chuẩn hoá hủy/hoàn (cột Doanh thu). */
  gross: number;
  /** Mức Phí Cố Định (%) của ngành hàng đã chọn cho sản phẩm; null = chưa chọn ngành. */
  ratePct: number | null;
}

export interface FeeEstimateInput {
  /** Ngày đặt yyyy-mm-dd (có thể kèm giờ). */
  date: string | null;
  lines: FeeLineInput[];
  /** Phí vận chuyển khách trả (0 với đơn hoàn). */
  buyerShipping: number;
  settings: Pick<FeeSettings, "sellerType" | "newSeller">;
  /** Mức (%) dùng cho dòng chưa rõ ngành. Bỏ trống = đơn có dòng chưa rõ ngành thì KHÔNG ước tính (trả null). */
  defaultRatePct?: number;
}

export interface FeeEstimate {
  fixed: number;
  processing: number;
  infra: number;
  total: number;
  /** Số dòng phải dùng mức mặc định vì ngành chưa rõ. */
  defaulted: number;
}

const day = (d: string | null): string | null => (d ? d.slice(0, 10) : null);

/** Mức Phí Cố Định sau ưu đãi người bán mới (chỉ shop thường, đơn trong giai đoạn 01/06–31/08/2026). */
export function effectiveFixedRate(ratePct: number, date: string | null, s: Pick<FeeSettings, "sellerType" | "newSeller">): number {
  const d = day(date);
  if (s.sellerType !== "non_mall" || !s.newSeller || !d || d < NEW_SELLER_FROM || d > NEW_SELLER_TO) return ratePct;
  return ratePct >= NEW_SELLER_THRESHOLD_PCT ? Math.max(0, ratePct - NEW_SELLER_CUT_POINTS) : ratePct / 2;
}

/**
 * - Phí Cố Định = Σ giá trị dòng × mức phí của ngành (sau ưu đãi nếu có).
 * - Phí Xử Lý Giao Dịch = 6% × (giá trị sản phẩm + phí ship khách trả). Cơ sở tính chưa được Shopee ghi rõ trong các bài đã đọc: đây là giả định.
 * - Phí Hạ Tầng = 3.000đ mỗi đơn (đơn từ 01/07/2025).
 * Dòng chưa rõ ngành dùng `defaultRatePct`; không truyền thì trả null (không đoán).
 */
export function estimateOrderFee(input: FeeEstimateInput): FeeEstimate | null {
  const dflt = input.defaultRatePct;
  if (input.lines.length === 0 || (dflt === undefined && input.lines.some((l) => l.ratePct === null))) return null;
  const gross = input.lines.reduce((n, l) => n + Math.max(0, l.gross), 0);
  if (gross <= 0) return null;
  let defaulted = 0;
  const fixed = input.lines.reduce((n, l) => {
    if (l.ratePct === null) defaulted++;
    return n + (Math.max(0, l.gross) * effectiveFixedRate(l.ratePct ?? (dflt as number), input.date, input.settings)) / 100;
  }, 0);
  const processing = ((gross + Math.max(0, input.buyerShipping)) * PROCESSING_FEE_PCT) / 100;
  const d = day(input.date);
  const infra = !d || d >= INFRA_FEE_FROM ? INFRA_FEE_VND : 0;
  const r = Math.round;
  return { fixed: r(fixed), processing: r(processing), infra, total: r(fixed) + r(processing) + infra, defaulted };
}

/* ---------- TikTok Shop ---------- */

export interface TiktokFeeInput {
  date: string | null;
  /** Đơn đã hoàn trả (đã giao rồi hoàn tiền): vẫn bị thu Phí Xử Lý, không còn hoa hồng/Phí Giao Dịch (giả định). */
  returned: boolean;
  /** `ratePct` null = ngành không có trong bảng → dùng mức mặc định của loại shop. */
  lines: FeeLineInput[];
  buyerShipping: number;
  settings: Pick<FeeSettings, "tiktokSellerType" | "tiktokAffiliatePct">;
}

export interface TiktokFeeEstimate {
  commission: number;
  transaction: number;
  processing: number;
  affiliate: number;
  total: number;
  /** Số dòng phải dùng mức mặc định vì ngành chưa rõ. */
  defaulted: number;
}

/**
 * Ước tính phí TikTok Shop của một đơn (hàm thuần, có test):
 * - Hoa hồng nền tảng = Σ giá trị dòng × mức phí ngành (ngành chưa rõ: mức mặc định 14% / Mall 16%).
 * - Phí Giao Dịch = 6% × (giá trị sản phẩm + phí ship khách trả). Công thức chính thức còn cộng chiết khấu của nền tảng: file đơn
 *   không có cột này nên bỏ qua (ước tính hơi thấp khi đơn có voucher của TikTok).
 * - Phí Xử Lý Đơn Hàng 3.000đ mỗi đơn từ 27/10/2025.
 * - Affiliate = giá trị sản phẩm × tỷ lệ người bán nhập (0 nếu không dùng).
 * Đơn hoàn trả: chỉ còn Phí Xử Lý. Đơn hủy do nơi gọi loại trước.
 */
export function estimateTiktokFee(input: TiktokFeeInput): TiktokFeeEstimate | null {
  if (input.lines.length === 0) return null;
  const gross = input.lines.reduce((n, l) => n + Math.max(0, l.gross), 0);
  if (gross <= 0) return null;
  const d = day(input.date);
  const processing = !d || d >= TIKTOK_PROCESSING_FROM ? TIKTOK_PROCESSING_VND : 0;
  if (input.returned) return { commission: 0, transaction: 0, processing, affiliate: 0, total: processing, defaulted: 0 };
  const dflt = TIKTOK_DEFAULT_RATE_PCT[input.settings.tiktokSellerType];
  let defaulted = 0;
  const commission = input.lines.reduce((n, l) => {
    if (l.ratePct === null) defaulted++;
    return n + (Math.max(0, l.gross) * (l.ratePct ?? dflt)) / 100;
  }, 0);
  const transaction = ((gross + Math.max(0, input.buyerShipping)) * TIKTOK_TRANSACTION_PCT) / 100;
  const affiliate = (gross * Math.max(0, input.settings.tiktokAffiliatePct)) / 100;
  const r = Math.round;
  return { commission: r(commission), transaction: r(transaction), processing, affiliate: r(affiliate), total: r(commission) + r(transaction) + processing + r(affiliate), defaulted };
}

/* ---------- Kênh tự nhập tỷ lệ (Lazada, Tiki...) ---------- */

/** Phí = (hoa hồng % + thanh toán %) × giá trị sản phẩm + phí cố định mỗi đơn. Đơn hoàn trả: chỉ phí cố định (giả định). */
export function estimateManualFee(rate: ManualFeeRate, lines: { gross: number }[], returned: boolean): number | null {
  const gross = lines.reduce((n, l) => n + Math.max(0, l.gross), 0);
  if (gross <= 0) return null;
  const pct = returned ? 0 : ((rate.commissionPct + rate.paymentPct) * gross) / 100;
  return Math.round(pct + rate.perOrder);
}
