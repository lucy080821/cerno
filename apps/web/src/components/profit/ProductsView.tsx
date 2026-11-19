"use client";

import { useMemo, useState } from "react";
import { parseNumber } from "@/lib/google/parse-number";
import { costKey, parseCostPaste, type CostEntry } from "@/lib/profit/catalog";
import type { ProductProfit } from "@/lib/profit/order-profit";
import { count, signed, vnd } from "./format";
import { Card, ErrorBox, Loading, NoOrders } from "./Shared";
import { useProfitSummary } from "./useProfit";
import styles from "./profit.module.css";

type Filter = "all" | "missing" | "loss";

interface RowView {
  key: string;
  name: string;
  sku: string | null;
  product: ProductProfit | null;
  catalogCost: number | null;
}

const toInput = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(Math.round(n * 100) / 100));

export function ProductsView({ initialFilter }: { initialFilter: Filter }) {
  const { data, error, loading, reload } = useProfitSummary();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteErrors, setPasteErrors] = useState<string[]>([]);

  const rows = useMemo<RowView[]>(() => {
    if (!data) return [];
    const catalog = new Map<string, CostEntry>((data.catalog.entries ?? []).map((e) => [costKey(e.sku), e]));
    const seen = new Set<string>();
    const out: RowView[] = (data.summary?.products ?? []).map((p) => {
      const k = costKey(p.key);
      seen.add(k);
      return { key: p.key, name: p.name, sku: p.sku, product: p, catalogCost: catalog.get(k)?.unitCost ?? null };
    });
    for (const [k, e] of catalog) if (!seen.has(k)) out.push({ key: e.sku, name: e.name || e.sku, sku: e.sku, product: null, catalogCost: e.unitCost });
    return out;
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} retry={reload} />;
  if (!data) return null;
  if (!data.source && rows.length === 0) return <NoOrders />;

  const missing = (r: RowView) => !!r.product && r.product.costMissing && r.catalogCost === null;
  const losing = (r: RowView) => r.product?.profit !== null && r.product?.profit !== undefined && r.product.profit < 0;
  const shown = rows.filter((r) => (filter === "missing" ? missing(r) : filter === "loss" ? losing(r) : true));
  const missingCount = rows.filter(missing).length;
  const missingOrders = data.summary?.missingCost ?? 0;
  const canEdit = data.editable && data.catalog.available;

  const changed = Object.entries(edits).filter(([key, v]) => {
    const r = rows.find((x) => x.key === key);
    return r && v.trim() !== toInput(r.catalogCost);
  });

  async function save() {
    const upserts: { sku: string; name?: string; unitCost: number }[] = [];
    const removes: string[] = [];
    for (const [key, v] of changed) {
      const r = rows.find((x) => x.key === key)!;
      if (v.trim() === "") {
        if (r.catalogCost !== null) removes.push(key);
        continue;
      }
      const n = parseNumber(v);
      if (n === null || n < 0) {
        setSaveError(`Giá vốn của "${r.name}" không hợp lệ.`);
        return;
      }
      upserts.push({ sku: key, name: r.name, unitCost: n });
    }
    setSaving(true);
    setSaveError("");
    setMessage("");
    try {
      const res = await fetch("/api/profit/costs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ upserts, removes }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setSaveError(json.error ?? "Không lưu được giá vốn.");
      else {
        setMessage(`Đã lưu ${count(json.saved ?? 0)} giá vốn, cập nhật ${count(json.updatedRows ?? 0)} dòng đơn hàng.`);
        setEdits({});
        await reload();
      }
    } catch {
      setSaveError("Lỗi mạng, thử lại sau.");
    } finally {
      setSaving(false);
    }
  }

  function applyPaste() {
    const { items, errors } = parseCostPaste(paste);
    setPasteErrors(errors);
    if (!items.length) return;
    const byKey = new Map(rows.map((r) => [costKey(r.key), r.key]));
    const next = { ...edits };
    let unknown = 0;
    for (const it of items) {
      const key = byKey.get(costKey(it.sku));
      if (key) next[key] = String(it.unitCost);
      else unknown++;
    }
    setEdits(next);
    setMessage(`Đã điền ${count(items.length - unknown)} giá vốn từ dữ liệu dán. Bấm "Lưu giá vốn" để áp dụng.${unknown ? ` ${count(unknown)} mã không có trong đơn hàng nên bị bỏ qua.` : ""}`);
    if (unknown === 0 && errors.length === 0) setPasteOpen(false);
  }

  return (
    <div className={styles.stack}>
      {!data.catalog.available && (
        <div className={styles.warn}><span>Bảng giá vốn chưa sẵn sàng: cần chạy migration <code>0017_product_costs.sql</code> trên Supabase.</span></div>
      )}
      {!data.editable && <div className={styles.note}>Bạn chỉ có quyền xem. Chủ workspace hoặc người được quyền sửa mới nhập được giá vốn.</div>}
      {missingCount > 0 && (
        <div className={styles.warn}>
          <span style={{ flex: 1 }}><b>{count(missingCount)}</b> sản phẩm chưa có giá vốn nên <b>{count(missingOrders)}</b> đơn chưa tính được lãi. Nhập giá vốn một lần, Cerno tính lại mọi đơn cũ và mới.</span>
          <button className={styles.btn} onClick={() => setFilter("missing")}>Xem các sản phẩm này</button>
        </div>
      )}

      <div className={styles.toolbar}>
        {([["all", "Tất cả"], ["missing", "Thiếu giá vốn"], ["loss", "Đang lỗ"]] as [Filter, string][]).map(([k, label]) => (
          <button key={k} className={`${styles.chip} ${filter === k ? styles.chipOn : ""}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
        <span style={{ flex: 1 }} />
        {canEdit && <button className={styles.btn} onClick={() => setPasteOpen((v) => !v)}>Dán từ Excel</button>}
        {canEdit && (
          <button className={`${styles.btn} ${styles.primary}`} disabled={saving || changed.length === 0} onClick={save}>
            {saving ? "Đang lưu…" : `Lưu giá vốn${changed.length ? ` (${changed.length})` : ""}`}
          </button>
        )}
      </div>

      {pasteOpen && (
        <Card title="Dán giá vốn từ Excel" aside="mỗi dòng: mã SKU (hoặc tên sản phẩm) và giá vốn mỗi cái">
          <textarea className={`${styles.input} ${styles.textarea}`} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"AO-01\t120000\nQUAN-02\t95.000"} aria-label="Dán giá vốn" />
          {pasteErrors.length > 0 && <div className={styles.small} style={{ marginTop: 8 }}>{pasteErrors.slice(0, 5).join(" · ")}</div>}
          <div className={styles.toolbar} style={{ marginTop: 10 }}>
            <button className={`${styles.btn} ${styles.primary}`} onClick={applyPaste} disabled={!paste.trim()}>Điền vào bảng</button>
            <button className={styles.btn} onClick={() => setPasteOpen(false)}>Đóng</button>
          </div>
        </Card>
      )}
      {message && <div className={styles.note}>{message}</div>}
      {saveError && <ErrorBox message={saveError} />}

      <Card title="Sản phẩm" aside={`${count(shown.length)} sản phẩm · giá vốn là giá mỗi cái`}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Sản phẩm</th><th className={styles.r}>Đã bán</th><th className={styles.r}>Giá bán TB</th><th className={styles.r}>Giá vốn / cái</th>
                <th className={styles.r}>Phí sàn / đơn</th><th className={styles.r}>Quảng cáo / đơn</th><th className={styles.r}>Lãi mỗi đơn</th><th className={styles.r}>Giá hòa vốn</th><th>Tình trạng</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const p = r.product;
                const value = edits[r.key] ?? toInput(r.catalogCost ?? p?.unitCost ?? null);
                const isMissing = missing(r);
                return (
                  <tr key={r.key} className={losing(r) ? styles.lossRow : ""}>
                    <td><b data-i18n-skip>{r.name}</b>{r.sku && r.sku !== r.name && <span className={styles.sub} data-i18n-skip>{r.sku}</span>}</td>
                    <td className={styles.r}>{p ? count(p.quantity) : "—"}</td>
                    <td className={styles.r}>{vnd(p?.avgPrice)}</td>
                    <td className={styles.r}>
                      <input
                        className={`${styles.input} ${styles.costInput} ${isMissing ? styles.costMissing : ""}`}
                        value={value}
                        placeholder="Chưa nhập"
                        disabled={!canEdit}
                        inputMode="decimal"
                        aria-label={`Giá vốn của ${r.name}`}
                        onChange={(e) => setEdits((m) => ({ ...m, [r.key]: e.target.value }))}
                      />
                    </td>
                    <td className={`${styles.r} ${styles.muted}`}>{p && p.orders ? vnd(p.fee / p.orders) : "—"}</td>
                    <td className={`${styles.r} ${styles.muted}`}>{p && p.orders ? vnd(p.adCost / p.orders) : "—"}</td>
                    <td className={styles.r}>{p?.profitPerOrder !== null && p?.profitPerOrder !== undefined ? <b className={p.profitPerOrder < 0 ? styles.neg : styles.pos}>{signed(p.profitPerOrder)}</b> : "—"}</td>
                    <td className={styles.r}>{vnd(p?.breakEvenPrice)}</td>
                    <td>
                      {isMissing ? <span className={`${styles.badge} ${styles.bWarn}`}>Thiếu giá vốn</span>
                        : losing(r) ? <span className={`${styles.badge} ${styles.bNeg}`}>Lỗ mỗi đơn</span>
                        : p?.profit !== null && p?.profit !== undefined ? <span className={`${styles.badge} ${styles.bPos}`}>Có lãi</span>
                        : p && p.orders === 0 ? <span className={styles.badge}>Chỉ có đơn hủy/hoàn</span>
                        : p && p.missingCostOrders > 0 ? <span className={styles.badge}>Chờ giá vốn sản phẩm khác</span>
                        : <span className={styles.badge}>Chưa bán</span>}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={9} className={styles.muted} style={{ textAlign: "center", padding: 28 }}>Không có sản phẩm nào.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <div className={styles.grid2}>
        <Card title="Giá hòa vốn là gì?">
          <p className={styles.small} style={{ lineHeight: 1.6 }}>Là giá bán mỗi cái thấp nhất để đơn không lỗ, đã tính giá vốn, phí sàn và quảng cáo chia vào đơn (trừ đi phí ship khách trả). Giá bán trung bình thấp hơn giá hòa vốn nghĩa là mỗi đơn bán ra đang mất tiền.</p>
        </Card>
        <Card title="Giá vốn được dùng thế nào?">
          <p className={styles.small} style={{ lineHeight: 1.6 }}>Giá vốn nhập ở đây được ghi vào cột &quot;Giá vốn&quot; của nguồn Đơn hàng đa kênh (giá mỗi cái × số lượng; đơn hủy và hoàn trả là 0), nên mọi dashboard và báo cáo đều thấy. Giá ở đây thay cho giá vốn có sẵn trong file. Áp dụng cho cả đơn cũ và các file tải lên sau này.</p>
        </Card>
      </div>
    </div>
  );
}
