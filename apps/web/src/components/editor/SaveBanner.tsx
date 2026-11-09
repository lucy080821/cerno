"use client";

import { useState } from "react";
import { resolveOverwrite, resolveReload, saveNow, useSave } from "@/lib/editor/save-store";
import s from "./editor.module.css";

/** Banner nổi báo lỗi lưu và cho chọn cách xử lý khi hai nơi cùng sửa một dashboard. */
export function SaveBanner() {
  const { status, message } = useSave();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (status === "conflict") {
    return (
      <div className={`${s.saveBanner} ${s.saveBannerWarn}`} role="alert">
        <span>
          {message ?? "Dashboard này vừa được lưu ở nơi khác (tab hoặc thiết bị khác). Chọn cách xử lý:"}
        </span>
        <button className={s.smallBtn} disabled={busy} onClick={() => run(resolveReload)}>
          Tải bản mới (bỏ thay đổi của tôi)
        </button>
        <button className={`${s.smallBtn} ${s.danger}`} disabled={busy} onClick={() => run(resolveOverwrite)}>
          Giữ bản của tôi (ghi đè)
        </button>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className={`${s.saveBanner} ${s.saveBannerErr}`} role="alert">
        <span>Chưa lưu được: {message}. Đang tự thử lại.</span>
        <button className={s.smallBtn} onClick={() => void saveNow()}>Thử lại ngay</button>
      </div>
    );
  }
  return null;
}
