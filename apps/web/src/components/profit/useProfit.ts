"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProfitSummary } from "@/lib/profit/order-profit";
import type { Todo } from "@/lib/profit/todos";
import type { CostEntry } from "@/lib/profit/catalog";

export interface SummaryResponse {
  source: { id: string; rowCount: number; lastSyncedAt: string | null } | null;
  editable: boolean;
  summary?: ProfitSummary;
  todos?: Todo[];
  catalog: { available: boolean; entries: CostEntry[] };
}

/** Tải tổng hợp lãi từng đơn của workspace. `reload()` sau khi lưu giá vốn. */
export function useProfitSummary() {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/profit/summary", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Không tải được số liệu.");
      else setData(json as SummaryResponse);
    } catch {
      setError("Lỗi mạng, thử lại sau.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}
