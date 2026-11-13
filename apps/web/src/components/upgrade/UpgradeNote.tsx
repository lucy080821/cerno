import { UPGRADE_PATH } from "@/lib/upgrade";
import s from "./upgrade.module.css";

/** Nút "Nâng cấp" gọn (mở tab mới để không mất biểu mẫu đang nhập). */
export function UpgradeLink({ children = "Nâng cấp" }: { children?: string }) {
  return (
    <a className={s.link} href={UPGRADE_PATH} target="_blank" rel="noopener">{children}</a>
  );
}

/**
 * Khung gợi ý nâng cấp cho người đang dùng gói Miễn phí. Giọng điệu cố ý nhẹ: khuyên dùng thử trước,
 * nâng cấp sau (không ép, không che tính năng đang dùng được).
 */
export function UpgradeNote() {
  return (
    <div className={s.note}>
      <p>
        <strong>Bạn đang dùng gói Miễn phí.</strong> Cứ trải nghiệm thử trước. Khi thấy cần thêm người nhận, báo cáo hằng ngày,
        phân tích bằng AI hay cảnh báo bất thường thì hãy nâng cấp.
      </p>
      <a className={s.btn} href={UPGRADE_PATH} target="_blank" rel="noopener">Nâng cấp</a>
    </div>
  );
}
