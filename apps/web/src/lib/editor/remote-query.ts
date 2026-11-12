"use client";

import { useEffect, useRef, useState } from "react";
import type { QueryResult, QuerySpec } from "@dashboard/chart-engine";
import { useData } from "./data-store";

/**
 * Truy vấn số liệu ở SERVER cho nguồn lớn (hàng chục nghìn dòng trở lên): trình duyệt chỉ nhận bảng đã gộp.
 * Kết quả được nhớ theo (nguồn, phiên bản dữ liệu, truy vấn) và các yêu cầu trùng nhau dùng chung một lần gọi.
 */

const CACHE_MAX = 300;
const cache = new Map<string, Promise<QueryResult>>();

async function post(base: string, sourceId: string, spec: QuerySpec): Promise<QueryResult> {
  const res = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceId, spec }),
  });
  const json = (await res.json().catch(() => ({}))) as { result?: QueryResult; error?: string };
  if (!res.ok || !json.result) throw new Error(json.error ?? "Không tính được số liệu.");
  return json.result;
}

/** Gọi (hoặc lấy từ bộ nhớ) kết quả của một truy vấn. `epoch` đổi khi dữ liệu nguồn đổi. */
export function fetchQuery(sourceId: string, spec: QuerySpec, epoch: number): Promise<QueryResult> {
  const base = useData.getState().queryBase;
  const key = `${base}|${sourceId}|${epoch}|${JSON.stringify(spec)}`;
  let p = cache.get(key);
  if (!p) {
    p = post(base, sourceId, spec);
    cache.set(key, p);
    // Lỗi thì không nhớ, để lần sau thử lại.
    p.catch(() => cache.delete(key));
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

export interface RemoteState {
  data: QueryResult | null;
  /** Đang chờ kết quả mới (data vẫn là kết quả cũ trong lúc chờ để chart không nháy trắng). */
  loading: boolean;
  error: string | null;
}

/**
 * Hook chạy một truy vấn server, tự chạy lại khi truy vấn hoặc dữ liệu nguồn đổi. `spec = null` thì không làm gì.
 * `debounceMs`: gộp các thay đổi liên tiếp (kéo thanh lọc) thành một lần gọi.
 */
export function useRemoteQuery(sourceId: string, spec: QuerySpec | null, debounceMs = 150): RemoteState {
  const epoch = useData((s) => s.epoch[sourceId] ?? 0);
  const key = spec ? `${sourceId}|${epoch}|${JSON.stringify(spec)}` : "";
  const [state, setState] = useState<RemoteState>({ data: null, loading: false, error: null });
  const specRef = useRef(spec);
  specRef.current = spec;

  useEffect(() => {
    const current = specRef.current;
    if (!current) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const t = window.setTimeout(() => {
      fetchQuery(sourceId, current, epoch)
        .then((data) => { if (live) setState({ data, loading: false, error: null }); })
        .catch((e: Error) => { if (live) setState((s) => ({ ...s, loading: false, error: e.message })); });
    }, debounceMs);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // `key` đã gồm nguồn, epoch và nội dung truy vấn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, debounceMs]);

  return state;
}

// Phần thuần nằm ở chart-engine (widget-spec.ts) để server (báo cáo, cảnh báo) dùng lại; giữ re-export cho editor.
export { calcDefsFor, specForWidget } from "@dashboard/chart-engine";
