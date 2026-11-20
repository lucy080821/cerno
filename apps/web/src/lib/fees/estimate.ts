import {
  INFRA_FEE_FROM, INFRA_FEE_VND, NEW_SELLER_CUT_POINTS, NEW_SELLER_FROM, NEW_SELLER_THRESHOLD_PCT, NEW_SELLER_TO, PROCESSING_FEE_PCT,
  type FeeSettings,
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
}

export interface FeeEstimate {
  fixed: number;
  processing: number;
  infra: number;
  total: number;
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
 * Trả null khi có dòng chưa chọn ngành (không đoán).
 */
export function estimateOrderFee(input: FeeEstimateInput): FeeEstimate | null {
  if (input.lines.length === 0 || input.lines.some((l) => l.ratePct === null)) return null;
  const gross = input.lines.reduce((n, l) => n + Math.max(0, l.gross), 0);
  if (gross <= 0) return null;
  const fixed = input.lines.reduce((n, l) => n + (Math.max(0, l.gross) * effectiveFixedRate(l.ratePct as number, input.date, input.settings)) / 100, 0);
  const processing = ((gross + Math.max(0, input.buyerShipping)) * PROCESSING_FEE_PCT) / 100;
  const d = day(input.date);
  const infra = !d || d >= INFRA_FEE_FROM ? INFRA_FEE_VND : 0;
  const r = Math.round;
  return { fixed: r(fixed), processing: r(processing), infra, total: r(fixed) + r(processing) + infra };
}
