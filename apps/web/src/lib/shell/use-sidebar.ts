"use client";

import { useEffect, useState } from "react";
import type { SidebarData } from "@/lib/server/sidebar";

/**
 * Số liệu của thanh bên và thanh trên (tên cửa hàng, kênh, số việc, gói, dashboard, nguồn), tải nền từ /api/shell/sidebar,
 * không chặn việc mở trang. Bản đã tải được nhớ ở module (30 giây) và dùng chung giữa các thành phần; tải lại khi quay lại tab.
 * Có thể gọi `refreshSidebar()` sau khi tạo/xoá dashboard hay nguồn để cây bên trái cập nhật ngay.
 */
let cache: { at: number; data: SidebarData } | null = null;
const FRESH_MS = 30_000;
const listeners = new Set<(d: SidebarData) => void>();
let inflight: Promise<void> | null = null;

function load(force: boolean): Promise<void> {
  if (!force && cache && Date.now() - cache.at < FRESH_MS) return Promise.resolve();
  if (inflight) return inflight;
  inflight = fetch("/api/shell/sidebar", { cache: "no-store", signal: AbortSignal.timeout(20_000) })
    .then((r) => (r.ok ? (r.json() as Promise<SidebarData>) : null))
    .then((d) => {
      if (!d) return;
      cache = { at: Date.now(), data: d };
      listeners.forEach((fn) => fn(d));
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export const refreshSidebar = () => load(true);

export function useSidebarData(refetchKey?: string): SidebarData | null {
  const [data, setData] = useState<SidebarData | null>(cache?.data ?? null);
  useEffect(() => {
    listeners.add(setData);
    void load(false);
    const onFocus = () => void load(false);
    window.addEventListener("focus", onFocus);
    return () => {
      listeners.delete(setData);
      window.removeEventListener("focus", onFocus);
    };
  }, [refetchKey]);
  return data;
}
