"use client";

import { useEffect } from "react";

/**
 * Hiện dần các phần tử có thuộc tính `data-rv` khi cuộn tới (fade + trượt lên).
 * Cách hoạt động: lúc đầu mọi thứ hiển thị bình thường (đủ nội dung cho bot và khi tắt JS). Sau khi trang tải xong,
 * thêm lớp `rv-on` lên <html> để ẩn các phần tử chưa vào khung nhìn, rồi bật `rv-in` từng cái khi chúng xuất hiện.
 * Người đặt "giảm chuyển động" trong hệ điều hành không bị ẩn gì cả.
 */
export function RevealController() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-rv]"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") {
      els.forEach((e) => e.classList.add("rv-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add("rv-in");
            io.unobserve(en.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    document.documentElement.classList.add("rv-on");
    els.forEach((e) => io.observe(e));
    return () => {
      io.disconnect();
      document.documentElement.classList.remove("rv-on");
      els.forEach((e) => e.classList.remove("rv-in"));
    };
  }, []);
  return null;
}
