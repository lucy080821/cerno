"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProfitSummary } from "@/lib/profit/order-profit";
import type { Todo } from "@/lib/profit/todos";
import type { CostEntry } from "@/lib/profit/catalog";
import type { FeePayload } from "@/lib/fees/constants";
import { periodRange, type Period } from "@/lib/profit/period";
import { usePeriod } from "@/lib/profit/period-store";

export interface SummaryResponse {
  source: { id: string; rowCount: number; lastSyncedAt: string | null } | null;
  editable: boolean;
  summary?: ProfitSummary;
  todos?: Todo[];
  catalog: { available: boolean; entries: CostEntry[] };
  /** Ước tính phí sàn (cài đặt + ngành hàng từng sản phẩm). */
  fees?: FeePayload;
  /** Khoảng ngày đã lọc (null = tất cả) và khoảng ngày của toàn bộ dữ liệu. */
  range?: { from: string; to: string } | null;
  dataRange?: { min: string | null; max: string | null };
}

/**
 * Bản đã tải được nhớ ở module theo khoảng thời gian: chuyển qua lại giữa Tổng quan, Lãi lỗ, Chi phí, Hoàn và hủy, Việc cần làm, Sản phẩm
 * hiện ngay số cũ rồi tải lại nền nếu đã quá 10 giây (không phải chờ vòng quay mỗi lần). `reload()` luôn tải mới, dùng sau khi lưu giá vốn/cài đặt.
 */
const cache = new Map<string, { at: number; data: SummaryResponse }>();
const STALE_MS = 10_000;
const MAX_CACHED = 12;

/** Chuỗi tham số `from`/`to` của kỳ (rỗng khi Tất cả). */
export const rangeQuery = (p: Period): string => {
  const r = periodRange(p);
  return r ? `from=${r.from}&to=${r.to}` : "";
};

/**
 * Tải tổng hợp lãi từng đơn của workspace theo khoảng thời gian đang chọn (dùng chung giữa các trang, xem period-store.ts).
 * `ignorePeriod`: luôn lấy toàn bộ thời gian (trang Sản phẩm và giá vốn, Việc cần làm: quản lý, không phải báo cáo theo kỳ).
 * `reload()` sau khi lưu giá vốn.
 */
export function useProfitSummary(opts: { ignorePeriod?: boolean } = {}) {
  const [period] = usePeriod();
  const query = opts.ignorePeriod ? "" : rangeQuery(period);
  const [data, setData] = useState<SummaryResponse | null>(cache.get(query)?.data ?? null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!cache.has(query));
  const reload = useCallback(async () => {
    // Đã có số cũ cho kỳ này thì không bật vòng quay, chỉ thay số khi tải xong.
    if (!cache.has(query)) setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/profit/summary${query ? `?${query}` : ""}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Không tải được số liệu.");
      else {
        // Số của các kỳ khác có thể đã cũ sau khi lưu giá vốn/cài đặt: bỏ đi để lần mở sau tải mới.
        for (const k of [...cache.keys()]) if (k !== query) cache.delete(k);
        if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
        cache.set(query, { at: Date.now(), data: json as SummaryResponse });
        setData(json as SummaryResponse);
      }
    } catch {
      setError("Lỗi mạng, thử lại sau.");
    } finally {
      setLoading(false);
    }
  }, [query]);
  useEffect(() => {
    const hit = cache.get(query);
    setData(hit?.data ?? null);
    setLoading(!hit);
    if (!hit || Date.now() - hit.at > STALE_MS) void reload();
  }, [query, reload]);
  return { data, error, loading, reload };
}
