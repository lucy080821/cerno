import type { LossReason } from "@/lib/profit/order-profit";

export const REASON_LABEL: Record<LossReason, string> = {
  return: "Đơn hoàn hàng",
  cancel: "Đơn hủy đã tốn quảng cáo",
  discount: "Giảm giá, voucher quá sâu",
  ads: "Quảng cáo cao hơn lãi gộp",
  cost: "Giá vốn và phí sàn cao hơn giá bán",
};
export const REASON_HINT: Record<LossReason, string> = {
  return: "Giữ video đóng gói và mở hàng để khiếu nại lấy lại phí.",
  cancel: "Tiền quảng cáo đã chi cho đơn này không lấy lại được.",
  discount: "Nếu bỏ voucher, đơn này đã có lãi.",
  ads: "Lãi trước quảng cáo vẫn dương, nhưng quảng cáo chia vào đơn cao hơn.",
  cost: "Giá bán thấp hơn giá vốn cộng phí sàn: cần tăng giá hoặc tìm nguồn hàng rẻ hơn.",
};
