/**
 * Hạn mức mềm của bản miễn phí. Dùng chung cho code kiểm tra và trang Điều khoản, để con số công bố
 * luôn khớp thực tế. (Số dashboard tối đa còn được ép ở DB bằng trigger trong migration 0004: nhớ đổi cả hai.)
 */
export const MAX_DASHBOARDS_PER_WORKSPACE = 20;
export const MAX_SOURCES_PER_WORKSPACE = 10;
/** Số người nhận báo cáo email tối đa cho một dashboard (Bước 7 sẽ phân theo gói). */
export const MAX_REPORT_SUBSCRIPTIONS_PER_DASHBOARD = 20;
/**
 * Tổng số dòng dữ liệu đã đồng bộ tối đa của MỘT workspace (cộng mọi nguồn). Giữ cơ sở dữ liệu miễn phí (500 MB) không bị
 * vài nguồn lớn chiếm hết. Nguồn vượt hạn mức bị cắt bớt khi đồng bộ và có thông báo.
 */
export const MAX_ROWS_PER_WORKSPACE = 300_000;
/** Số luật cảnh báo tối đa cho một dashboard (Bước 7 sẽ phân theo gói). */
export const MAX_ALERT_RULES_PER_DASHBOARD = 30;
