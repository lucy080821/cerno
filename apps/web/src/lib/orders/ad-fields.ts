/** Các trường của file chi phí quảng cáo. Tách riêng (không kéo theo thư viện đọc Excel) để giao diện dùng được. */
export const AD_FIELDS = ["date", "spend", "channel"] as const;
export type AdField = (typeof AD_FIELDS)[number];
export type AdMapping = Partial<Record<AdField, number>>;
export const AD_LABELS: Record<AdField, string> = { date: "Ngày", spend: "Chi phí quảng cáo (đồng)", channel: "Kênh (nếu file có nhiều kênh)" };
