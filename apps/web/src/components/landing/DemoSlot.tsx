"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import s from "@/app/landing.module.css";

/** Ảnh chụp dashboard: hiện ngay khi tải trang (và cho bot/khi tắt JS), được thay bằng bản tương tác khi cuộn tới gần. */
function Poster() {
  return (
    <Image
      src="/img/dashboard-demo.webp"
      alt="Dashboard phân tích kênh YouTube tạo bằng Cerno gồm thẻ KPI tổng lượt xem, biểu đồ đường người đăng ký theo thời gian, biểu đồ cột và bảng video"
      width={1667}
      height={938}
      sizes="(max-width: 1100px) 100vw, 1040px"
      className={s.demoPoster}
    />
  );
}

// ECharts và bộ vẽ dashboard khá nặng: chỉ tải khi người xem cuộn tới gần phần này, trang chủ vẫn nhẹ.
const Demo = dynamic(() => import("./DemoDashboard"), { ssr: false, loading: () => <Poster /> });

export function DemoSlot() {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: "500px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className={s.demoScroll}>
      <div ref={ref} className={s.demoFrame}>
        {near ? <Demo /> : <Poster />}
      </div>
    </div>
  );
}
