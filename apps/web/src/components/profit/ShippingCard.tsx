"use client";

import { useEffect, useMemo, useState } from "react";
import { CHANNELS } from "@/lib/orders/canonical";
import { parseNumber } from "@/lib/google/parse-number";
import type { FeePayload } from "@/lib/fees/constants";
import { MAX_SHIP_AMOUNT } from "@/lib/profit/shipping";
import { count, vnd } from "./format";
import { Card } from "./Shared";
import styles from "./profit.module.css";

type Form = Record<string, { perOrder: string; perReturn: string }>;

const toInput = (n: number | undefined) => (n ? String(n) : "");

/**
 * Phí vận chuyển SHOP CHỊU, ước tính theo trung bình mỗi đơn của từng kênh. File đơn hàng của sàn thường không có khoản này, nên
 * người bán nhập mức trung bình lấy từ báo cáo đối soát của sàn (tổng phí ship shop chịu ÷ số đơn). Chỉ dùng ở các trang lãi.
 */
export function ShippingCard({ ship, channels, estimated, editable, onSaved }: {
  ship: FeePayload["ship"] | undefined;
  /** Các kênh đang có đơn hàng. */
  channels: string[];
  /** Số đơn đang dùng phí ship ước tính. */
  estimated: number;
  editable: boolean;
  onSaved: () => void;
}) {
  const rates = ship?.rates ?? {};
  const list = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...channels, ...Object.keys(rates)]) {
      if (!seen.has(c) && (CHANNELS as readonly string[]).includes(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }, [channels, rates]);

  const initial = useMemo<Form>(() => Object.fromEntries(list.map((c) => [c, { perOrder: toInput(rates[c]?.perOrder), perReturn: toInput(rates[c]?.perReturn) }])), [list, rates]);
  const [form, setForm] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => setForm(initial), [initial]);

  const dirty = list.some((c) => (form[c]?.perOrder ?? "") !== (initial[c]?.perOrder ?? "") || (form[c]?.perReturn ?? "") !== (initial[c]?.perReturn ?? ""));
  const set = (c: string, k: "perOrder" | "perReturn", v: string) => setForm((f) => ({ ...f, [c]: { ...(f[c] ?? { perOrder: "", perReturn: "" }), [k]: v } }));

  const num = (v: string | undefined): number | null => {
    if (!v || v.trim() === "") return 0;
    const n = parseNumber(v);
    return n !== null && n >= 0 && n <= MAX_SHIP_AMOUNT ? n : null;
  };

  async function save() {
    const out: Record<string, { perOrder: number; perReturn: number }> = {};
    for (const c of list) {
      const a = num(form[c]?.perOrder);
      const b = num(form[c]?.perReturn);
      if (a === null || b === null) {
        setError(`Số tiền của kênh ${c} không hợp lệ.`);
        return;
      }
      out[c] = { perOrder: a, perReturn: b };
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/shipping", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rates: out }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Không lưu được.");
      else {
        setMessage("Đã lưu. Lãi từng đơn được tính lại với phí vận chuyển này.");
        onSaved();
      }
    } catch {
      setError("Lỗi mạng, thử lại sau.");
    } finally {
      setBusy(false);
    }
  }

  const unavailable = ship && !ship.available;
  return (
    <Card title="Phí vận chuyển shop chịu (ước tính)" aside={estimated > 0 ? `${count(estimated)} đơn đang dùng` : undefined}>
      {unavailable && <div className={styles.warn}>Cần chạy migration 0020_shipping_costs.sql trên Supabase trước khi nhập phí vận chuyển.</div>}
      <p className={styles.small} style={{ marginTop: 0 }}>
        File đơn hàng của sàn thường không có phí ship mà shop phải chịu (phí ship thực tế trừ phần khách trả, thêm phí chiều hoàn của đơn hoàn). Nhập mức trung bình mỗi đơn của từng kênh: lấy tổng phí ship shop chịu trong báo cáo đối soát của sàn chia cho số đơn. Đơn hủy không tính.
      </p>
      {list.length === 0 ? (
        <p className={styles.small}>Chưa có đơn hàng nào để nhập.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Kênh</th><th className={styles.r}>Mỗi đơn đã gửi (đ)</th><th className={styles.r}>Thêm cho mỗi đơn hoàn (đ)</th><th className={styles.r}>Đang dùng</th></tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c}>
                  <td><b>{c}</b></td>
                  <td className={styles.r}>
                    <input className={styles.costInput} inputMode="numeric" placeholder="0" aria-label={`Phí ship mỗi đơn của kênh ${c}`} disabled={!editable || unavailable} value={form[c]?.perOrder ?? ""} onChange={(e) => set(c, "perOrder", e.target.value)} />
                  </td>
                  <td className={styles.r}>
                    <input className={styles.costInput} inputMode="numeric" placeholder="0" aria-label={`Phí ship chiều hoàn của kênh ${c}`} disabled={!editable || unavailable} value={form[c]?.perReturn ?? ""} onChange={(e) => set(c, "perReturn", e.target.value)} />
                  </td>
                  <td className={`${styles.r} ${styles.muted}`}>{rates[c] ? `${vnd(rates[c].perOrder)} · +${vnd(rates[c].perReturn)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className={styles.neg} role="alert">{error}</p>}
      {message && <p className={styles.pos} role="status">{message}</p>}
      {editable && !unavailable && list.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button className={`${styles.btn} ${styles.primary}`} disabled={busy || !dirty} onClick={save}>{busy ? "Đang lưu…" : "Lưu phí vận chuyển"}</button>
        </div>
      )}
      <p className={styles.small} style={{ marginTop: 10 }}>Đây là số ước tính theo mức trung bình, không phải phí ship thật của từng đơn. Số này chỉ dùng ở các trang lãi, không ghi vào bảng đơn hàng nên dashboard và báo cáo email chưa thấy.</p>
    </Card>
  );
}
