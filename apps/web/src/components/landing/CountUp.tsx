"use client";

import { useEffect, useRef } from "react";

/**
 * Con số đếm tăng dần từ 0 khi cuộn tới. HTML gốc (cho bot, khi tắt JS, khi giảm chuyển động) luôn chứa số cuối,
 * nên chỉ khi trình duyệt chạy được hiệu ứng mới đổi chữ trong DOM.
 */
export function CountUp({ to, suffix = "", ms = 1100 }: { to: number; suffix?: string; ms?: number }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined" || to <= 0) return;

    let raf = 0;
    const show = (v: number) => {
      el.textContent = `${Math.round(v)}${suffix}`;
    };
    show(0);
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / ms);
          show(to * (1 - Math.pow(1 - p, 3))); // chậm dần về cuối
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      el.textContent = `${to}${suffix}`;
    };
  }, [to, suffix, ms]);

  return <b ref={ref}>{to}{suffix}</b>;
}
