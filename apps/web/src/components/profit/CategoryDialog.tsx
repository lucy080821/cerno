"use client";

import { useEffect, useRef, useState } from "react";
import type { SellerType } from "@/lib/fees/constants";
import styles from "./profit.module.css";

interface Item {
  path: string;
  ratePct: number;
}

export const ratePctText = (n: number): string => `${n.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`;

/**
 * Chọn ngành hàng trong biểu Phí Cố Định của Shopee. Tìm qua /api/fees/categories (bảng phí nằm ở máy chủ).
 * `onPick(path, applyToAll)`: applyToAll = dùng ngành này cho mọi sản phẩm chưa chọn ngành.
 */
export function CategoryDialog({ productName, sellerType, canApplyAll, onPick, onClose }: {
  productName: string;
  sellerType: SellerType;
  canApplyAll: boolean;
  onPick: (path: string, applyToAll: boolean) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [applyAll, setApplyAll] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Gõ xong 250ms mới hỏi máy chủ.
  useEffect(() => {
    const text = q.trim();
    if (!text) {
      setItems([]);
      setError("");
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/fees/categories?type=${sellerType}&q=${encodeURIComponent(text)}`, { cache: "no-store" })
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
          if (!alive) return;
          if (!res.ok) setError(json.error ?? "Không tìm được ngành hàng.");
          else {
            setItems(json.items ?? []);
            setError("");
          }
        })
        .catch(() => alive && setError("Lỗi mạng, thử lại sau."))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, sellerType]);

  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Chọn ngành hàng tính phí">
        <div className={styles.dialogHead}>
          <div>
            <h2>Chọn ngành hàng tính phí</h2>
            <div className={styles.small} data-i18n-skip>{productName}</div>
          </div>
          <button className={styles.btn} onClick={onClose}>Đóng</button>
        </div>
        <input
          ref={input}
          className={styles.input}
          placeholder="Gõ tên ngành, ví dụ: tai nghe, áo thun, son môi…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Tìm ngành hàng"
        />
        {canApplyAll && (
          <label className={styles.checkRow}>
            <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
            <span>Dùng ngành này cho mọi sản phẩm chưa chọn ngành</span>
          </label>
        )}
        <div className={styles.results}>
          {error && <div className={styles.warn}><span>{error}</span></div>}
          {!q.trim() && <p className={styles.small}>Gõ vài chữ để tìm. Mức phí là Phí Cố Định theo biểu của Shopee, đã gồm thuế GTGT.</p>}
          {q.trim() && !loading && !error && items.length === 0 && <p className={styles.small}>Không thấy ngành nào khớp. Thử chữ ngắn hơn hoặc bỏ dấu.</p>}
          {items.map((it) => (
            <button key={it.path} className={styles.result} onClick={() => onPick(it.path, applyAll)}>
              <span data-i18n-skip>{it.path}</span>
              <b>{ratePctText(it.ratePct)}</b>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
