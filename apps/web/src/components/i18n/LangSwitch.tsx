"use client";

import { useLang, type Lang } from "@/lib/i18n/store";
import s from "./langSwitch.module.css";

const OPTIONS: Array<{ id: Lang; short: string; label: string }> = [
  { id: "vi", short: "VI", label: "Tiếng Việt" },
  { id: "en", short: "EN", label: "English" },
];

/**
 * Nút chuyển ngôn ngữ Việt ↔ Anh. Đổi ngay trên trang đang xem (không tải lại, không sang trang khác).
 * `floating` = ghim góc trên bên phải cho trang không có thanh đầu (trang nhúng, link xem).
 * Nhãn tiếng Việt/English cố ý viết bằng đúng ngôn ngữ của nó nên không bị dịch.
 */
export function LangSwitch({ floating = false, compact = false, className = "" }: { floating?: boolean; compact?: boolean; className?: string }) {
  const lang = useLang((st) => st.lang);
  const setLang = useLang((st) => st.setLang);
  return (
    <div
      className={`${s.wrap} ${floating ? s.floating : ""} ${compact ? s.compact : ""} ${className}`}
      role="group"
      aria-label="Language / Ngôn ngữ"
      data-i18n-skip
    >
      {!compact && <svg className={s.globe} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c3 3 3 15 0 18" /><path d="M12 3c-3 3-3 15 0 18" />
      </svg>}
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          lang={o.id}
          className={`${s.btn} ${lang === o.id ? s.on : ""}`}
          aria-pressed={lang === o.id}
          title={o.label}
          onClick={() => setLang(o.id)}
        >
          {o.short}
        </button>
      ))}
    </div>
  );
}
