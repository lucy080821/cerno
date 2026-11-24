"use client";

import { useCallback, useSyncExternalStore } from "react";
import { ALL_TIME, sanitizePeriod, type Period } from "./period";

/**
 * Khoảng thời gian đang chọn, dùng chung cho mọi trang lãi (chọn ở trang này, sang trang khác vẫn giữ). Lưu ở localStorage để
 * tải lại trang vẫn giữ; lần vẽ đầu (cả khi hydrate) luôn là Tất cả để máy chủ và trình duyệt khớp nhau.
 */
const KEY = "cerno.profit.period";
const listeners = new Set<() => void>();
let current: Period = ALL_TIME;
let loaded = false;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) current = sanitizePeriod(JSON.parse(raw));
  } catch {
    /* localStorage bị chặn hoặc dữ liệu hỏng: dùng Tất cả */
  }
}

const subscribe = (fn: () => void) => {
  load();
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    try {
      current = e.newValue ? sanitizePeriod(JSON.parse(e.newValue)) : ALL_TIME;
    } catch {
      current = ALL_TIME;
    }
    listeners.forEach((l) => l());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
};
const getSnapshot = (): Period => {
  load();
  return current;
};
const getServerSnapshot = (): Period => ALL_TIME;

export function setPeriod(p: Period) {
  current = sanitizePeriod(p);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* không lưu được vẫn dùng được trong phiên này */
  }
  listeners.forEach((l) => l());
}

export function usePeriod(): [Period, (p: Period) => void] {
  const period = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [period, useCallback((p: Period) => setPeriod(p), [])];
}
