"use client";

import { useEffect, useState } from "react";
import type { Todo } from "./todos";

/**
 * Việc cần làm đã đánh dấu xong, nhớ trong trình duyệt (localStorage). Dùng chung cho trang Việc cần làm và huy hiệu ở thanh bên
 * để hai nơi luôn khớp nhau: đánh dấu ở trang này thì số trên thanh bên giảm ngay, cả khi mở nhiều tab.
 */
export const DONE_KEY = "cerno.profit.todos.done";
const EVENT = "cerno:todos-done";

export function readDoneTodos(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(DONE_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeDoneTodos(ids: string[]): void {
  try {
    window.localStorage.setItem(DONE_KEY, JSON.stringify(ids));
  } catch {
    /* chế độ riêng tư: chỉ nhớ trong phiên */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: ids }));
}

/** Danh sách đã xong, tự cập nhật khi nơi khác đổi (cùng tab qua sự kiện riêng, tab khác qua sự kiện storage). */
export function useDoneTodos(): string[] {
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setDone(readDoneTodos());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return done;
}

/** Tách việc còn lại và việc đã xong (giữ nguyên thứ tự gốc). Hàm thuần. */
export function splitTodos(todos: Todo[], done: string[]): { open: Todo[]; closed: Todo[] } {
  const set = new Set(done);
  return { open: todos.filter((t) => !set.has(t.id)), closed: todos.filter((t) => set.has(t.id)) };
}

/** Số việc còn lại, dùng cho huy hiệu thanh bên: `ids` là mọi việc đang gợi ý (từ máy chủ). Hàm thuần. */
export function pendingCount(ids: string[], done: string[]): number {
  const set = new Set(done);
  return ids.filter((id) => !set.has(id)).length;
}
