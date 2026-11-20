"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProfitSummary } from "@/lib/profit/order-profit";
import type { Todo } from "@/lib/profit/todos";
import type { CostEntry } from "@/lib/profit/catalog";
import type { FeePayload } from "@/lib/fees/constants";

export interface SummaryResponse {
  source: { id: string; rowCount: number; lastSyncedAt: string | null } | null;
  editable: boolean;
  summary?: ProfitSummary;
  todos?: Todo[];
  catalog: { available: boolean; entries: CostEntry[] };
  /** Ước tính phí sàn Shopee (cài đặt + ngành hàng từng sản phẩm). */
  fees?: FeePayload;
}

/**
 * Bản đã tải được nhớ ở module: chuyển qua lại giữa Tổng quan, Lãi lỗ, Chi phí, Hoàn và hủy, Việc cần làm, Sản phẩm hiện ngay số cũ
 * rồi tải lại nền nếu đã quá 10 giây (không phải chờ vòng quay mỗi lần). `reload()` luôn tải mới, dùng sau khi lưu giá vốn/cài đặt.
 */
let cache: { at: number; data: SummaryResponse } | null = null;
const STALE_MS = 10_000;

/** Tải tổng hợp lãi từng đơn của workspace. `reload()` sau khi lưu giá vốn. */
export function useProfitSummary() {
  const [data, setData] = useState<SummaryResponse | null>(cache?.data ?? null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!cache);
  const reload = useCallback(async () => {
    // Đã có số cũ thì không bật vòng quay, chỉ thay số khi tải xong.
    if (!cache) setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/profit/summary", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Không tải được số liệu.");
      else {
        cache = { at: Date.now(), data: json as SummaryResponse };
        setData(json as SummaryResponse);
      }
    } catch {
      setError("Lỗi mạng, thử lại sau.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!cache || Date.now() - cache.at > STALE_MS) void reload();
  }, [reload]);
  return { data, error, loading, reload };
}
