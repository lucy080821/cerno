"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/Spinner";

// ECharts và bộ vẽ dashboard khá nặng: chỉ tải khi thật sự mở bản xem trước, thư viện mẫu vẫn nhẹ.
export const TemplateViewerLazy = dynamic(() => import("./TemplateViewer"), {
  ssr: false,
  loading: () => (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
      <Spinner size={28} label="Đang tải bản xem trước…" />
    </div>
  ),
});
