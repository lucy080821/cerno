"use client";

import { Card } from "@/components/profit/Shared";
import { AlertsTab } from "@/components/editor/AlertsTab";
import { ReportsTab } from "@/components/editor/NotifyDialog";
import profit from "@/components/profit/profit.module.css";
import editor from "@/components/editor/editor.module.css";

/**
 * Cài đặt cảnh báo / báo cáo định kỳ ngay tại trang riêng, THEO CỬA HÀNG: đọc dữ liệu bán hàng đa kênh (doanh thu, lãi, hủy/hoàn, kênh,
 * sản phẩm của các trang lãi), không cần chọn dashboard. Dùng lại đúng hai tab của hộp thoại Thông báo ở editor, với phạm vi `null`
 * (cùng khung giao diện, giới hạn gói và kiểm quyền bằng RLS). Cảnh báo/báo cáo gắn dashboard đã tạo trước đó vẫn chạy và được liệt kê
 * ở bảng đầu trang; muốn sửa chúng thì mở dashboard.
 */
export function NotifyManager({ kind }: { kind: "alerts" | "reports" }) {
  return (
    <div id="manage" className={profit.stack}>
      <Card title={kind === "alerts" ? "Cảnh báo của cửa hàng" : "Báo cáo của cửa hàng"} aside="theo dữ liệu bán hàng đa kênh">
        <div className={editor.scope}>{kind === "alerts" ? <AlertsTab dashboardId={null} /> : <ReportsTab dashboardId={null} widgets={[]} />}</div>
      </Card>
    </div>
  );
}
