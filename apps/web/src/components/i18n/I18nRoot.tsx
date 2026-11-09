"use client";

import { useEffect, useRef } from "react";
import { DomTranslator } from "@/lib/i18n/dom";
import { translateToEnglish } from "@/lib/i18n";
import { readAccountLang, saveAccountLang } from "@/lib/i18n/account";
import { readSavedLang, useLang, writeSavedLang } from "@/lib/i18n/store";

/**
 * Gắn một lần ở layout gốc: nạp ngôn ngữ đã lưu, đặt `<html lang>`, và dịch chữ trên trang theo thời gian thực
 * mỗi khi đổi ngôn ngữ hoặc trang vẽ thêm nội dung. Không tạo trang riêng cho từng ngôn ngữ.
 */
export function I18nRoot() {
  const lang = useLang((s) => s.lang);
  const tx = useRef<DomTranslator | null>(null);

  useEffect(() => {
    const t = new DomTranslator(document.documentElement, translateToEnglish);
    tx.current = t;
    const saved = readSavedLang();
    if (saved !== useLang.getState().lang) useLang.setState({ lang: saved });
    t.setLang(saved);
    // Đã đăng nhập: ngôn ngữ của tài khoản được ưu tiên (để máy khác cũng đúng). Tài khoản chưa lưu thì lưu lựa chọn hiện tại.
    void readAccountLang().then((acc) => {
      if (acc === null) return;
      if (acc === undefined) void saveAccountLang(useLang.getState().lang);
      else if (acc !== useLang.getState().lang) {
        writeSavedLang(acc);
        useLang.setState({ lang: acc });
      }
    });
    // Tab khác đổi ngôn ngữ thì tab này theo.
    const onStorage = (e: StorageEvent) => {
      if (e.key === "cerno.lang") useLang.setState({ lang: readSavedLang() });
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      t.stop();
      tx.current = null;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    tx.current?.setLang(lang);
  }, [lang]);

  return null;
}
