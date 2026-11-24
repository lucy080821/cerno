"use client";

import { useEffect, useMemo, useState } from "react";
import { parseNumber } from "@/lib/google/parse-number";
import type { FeePayload } from "@/lib/fees/constants";
import { CHANNELS } from "@/lib/orders/canonical";
import { Card } from "./Shared";
import styles from "./profit.module.css";

type Form = Record<string, { commissionPct: string; paymentPct: string; perOrder: string }>;

const MAX = { commissionPct: 60, paymentPct: 20, perOrder: 1_000_000 };
const toInput = (n: number | undefined) => (n ? String(n) : "");
const isManual = (c: string) => (CHANNELS as readonly string[]).includes(c) && c !== "Shopee" && c !== "TikTok Shop";
const SUGGESTED = ["Lazada", "Tiki"];

/**
 * Phí sàn người bán TỰ NHẬP cho các kênh chưa có biểu phí trong Cerno (Lazada, Tiki, Facebook, Khác): hoa hồng %, phí thanh toán %
 * (cùng tính trên giá trị sản phẩm) và phí cố định mỗi đơn. Chỉ dùng cho đơn mà file không ghi phí. Lấy tỷ lệ từ Seller Center hoặc báo
 * cáo đối soát của sàn (tổng phí ÷ tổng doanh thu).
 */
export function ManualFeeCard({ manual, channels, editable, onSaved }: {
  manual: FeePayload["manual"] | undefined;
  /** Các kênh đang có đơn hàng. */
  channels: string[];
  editable: boolean;
  onSaved: () => void;
}) {
  const rates = manual?.rates;
  const list = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...channels, ...Object.keys(rates ?? {}), ...SUGGESTED]) {
      if (!seen.has(c) && isManual(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }, [channels, rates]);

  const initial = useMemo<Form>(
    () => Object.fromEntries(list.map((c) => [c, { commissionPct: toInput(rates?.[c]?.commissionPct), paymentPct: toInput(rates?.[c]?.paymentPct), perOrder: toInput(rates?.[c]?.perOrder) }])),
    [list, rates],
  );
  const [form, setForm] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => setForm(initial), [initial]);

  const keys = ["commissionPct", "paymentPct", "perOrder"] as const;
  const dirty = list.some((c) => keys.some((k) => (form[c]?.[k] ?? "") !== (initial[c]?.[k] ?? "")));
  const set = (c: string, k: (typeof keys)[number], v: string) => setForm((f) => ({ ...f, [c]: { ...(f[c] ?? { commissionPct: "", paymentPct: "", perOrder: "" }), [k]: v } }));
  const num = (v: string | undefined, max: number): number | null => {
    if (!v || v.trim() === "") return 0;
    const n = parseNumber(v);
    return n !== null && n >= 0 && n <= max ? n : null;
  };

  async function save() {
    const out: Record<string, { commissionPct: number; paymentPct: number; perOrder: number }> = {};
    for (const c of list) {
      const a = num(form[c]?.commissionPct, MAX.commissionPct);
      const b = num(form[c]?.paymentPct, MAX.paymentPct);
      const d = num(form[c]?.perOrder, MAX.perOrder);
      if (a === null || b === null || d === null) {
        setError(`Tỷ lệ hoặc số tiền của kênh ${c} không hợp lệ.`);
        return;
      }
      out[c] = { commissionPct: a, paymentPct: b, perOrder: d };
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/fees/manual", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rates: out }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Không lưu được.");
      else {
        setMessage("Đã lưu. Lãi từng đơn được tính lại với tỷ lệ phí này.");
        onSaved();
      }
    } catch {
      setError("Lỗi mạng, thử lại sau.");
    } finally {
      setBusy(false);
    }
  }

  const unavailable = manual && !manual.available;
  return (
    <Card title="Phí sàn tự nhập (Lazada, Tiki và kênh khác)">
      {unavailable && <div className={styles.warn}>Cần chạy migration 0021_multi_platform_fees.sql trên Supabase trước khi nhập phí sàn.</div>}
      <p className={styles.small} style={{ marginTop: 0 }}>
        Cerno chưa có biểu phí chính thức của Lazada và Tiki để nhập sẵn, nên bạn tự nhập tỷ lệ lấy từ Seller Center hoặc báo cáo đối soát của sàn: hoa hồng và phí thanh toán tính theo % giá trị sản phẩm, cộng phí cố định mỗi đơn (nếu có). Chỉ dùng cho đơn mà file không ghi phí; đơn hoàn trả chỉ tính phí cố định; đơn hủy không tính.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>Kênh</th><th className={styles.r}>Hoa hồng (%)</th><th className={styles.r}>Phí thanh toán (%)</th><th className={styles.r}>Phí cố định mỗi đơn (đ)</th></tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c}>
                <td><b>{c}</b></td>
                {keys.map((k) => (
                  <td key={k} className={styles.r}>
                    <input
                      className={styles.costInput}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={`${k === "commissionPct" ? "Hoa hồng" : k === "paymentPct" ? "Phí thanh toán" : "Phí cố định mỗi đơn"} của kênh ${c}`}
                      disabled={!editable || unavailable}
                      value={form[c]?.[k] ?? ""}
                      onChange={(e) => set(c, k, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className={styles.neg} role="alert">{error}</p>}
      {message && <p className={styles.pos} role="status">{message}</p>}
      {editable && !unavailable && (
        <div style={{ marginTop: 12 }}>
          <button className={`${styles.btn} ${styles.primary}`} disabled={busy || !dirty} onClick={save}>{busy ? "Đang lưu…" : "Lưu phí sàn"}</button>
        </div>
      )}
      <p className={styles.small} style={{ marginTop: 10 }}>Đây là số ước tính theo tỷ lệ bạn nhập, không phải phí thật của từng đơn. Số này chỉ dùng ở các trang lãi, không ghi vào bảng đơn hàng nên dashboard và báo cáo email chưa thấy.</p>
    </Card>
  );
}
