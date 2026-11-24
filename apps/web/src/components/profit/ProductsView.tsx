"use client";

import { useEffect, useMemo, useState } from "react";
import { parseNumber } from "@/lib/google/parse-number";
import { costKey, parseCostPaste, type CostEntry } from "@/lib/profit/catalog";
import type { ProductProfit } from "@/lib/profit/order-profit";
import { count, signed, vnd } from "./format";
import { DEFAULT_FEE_SETTINGS, FEE_CHANNEL, INFRA_FEE_VND, PROCESSING_FEE_PCT, SELLER_TYPES, type FeeSettings, type SellerType } from "@/lib/fees/constants";
import { CategoryDialog, ratePctText } from "./CategoryDialog";
import { autoCategoryCount, Card, ErrorBox, FeeEstimateNote, Loading, NoOrders } from "./Shared";
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
  // Ước tính phí sàn Shopee: bản nháp cài đặt, sản phẩm đang chọn ngành, trạng thái lưu.
  const [feeForm, setFeeForm] = useState<FeeSettings>(DEFAULT_FEE_SETTINGS);
  const [catRow, setCatRow] = useState<RowView | null>(null);
  const [feeSaving, setFeeSaving] = useState(false);
  const fees = data?.fees;
  useEffect(() => {
    if (fees?.settings) setFeeForm(fees.settings);
  }, [fees?.settings.enabled, fees?.settings.sellerType, fees?.settings.newSeller]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const canEditFees = data.editable && !!fees?.available;
  // Ngành hàng chỉ có nghĩa với sản phẩm bán trên Shopee (chỉ Shopee có biểu phí để ước tính); sản phẩm chưa có đơn vẫn coi là áp dụng.
  const sold = (r: RowView) => !r.product || r.product.channels.includes(FEE_CHANNEL);
  const shopeeRows = rows.filter(sold);
  const chosenCount = shopeeRows.filter((r) => fees?.categories[costKey(r.key)]).length;
  // Sản phẩm chưa được người bán chọn ngành nhưng Cerno đã tự nhận diện từ tên (đã dùng để ước tính phí, người bán chỉ cần lướt qua).
  const autoRows = shopeeRows.filter((r) => !fees?.categories[costKey(r.key)] && fees?.suggestions[costKey(r.key)]);
  const autoCount = autoRows.length;
  const feeFormChanged = !!fees && (feeForm.enabled !== fees.settings.enabled || feeForm.sellerType !== fees.settings.sellerType || feeForm.newSeller !== fees.settings.newSeller);

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

  /** Gọi PUT /api/fees rồi nạp lại số liệu (lãi được tính lại ở máy chủ). */
  async function saveFees(body: { settings?: FeeSettings; upserts?: { sku: string; category: string }[]; removes?: string[] }, okText: string) {
    setFeeSaving(true);
    setSaveError("");
    setMessage("");
    try {
      const res = await fetch("/api/fees", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setSaveError(json.error ?? "Không lưu được cài đặt phí.");
      else {
        setMessage(okText);
        await reload();
      }
    } catch {
      setSaveError("Lỗi mạng, thử lại sau.");
    } finally {
      setFeeSaving(false);
    }
  }

  function pickCategory(row: RowView, path: string, applyAll: boolean) {
    setCatRow(null);
    const targets = applyAll ? rows.filter((r) => r.key === row.key || (sold(r) && !fees?.categories[costKey(r.key)])) : [row];
    void saveFees({ upserts: targets.map((r) => ({ sku: r.key, category: path })) }, `Đã chọn ngành cho ${count(targets.length)} sản phẩm.`);
  }

  /** Người bán xác nhận ngành Cerno đã tự nhận diện: lưu thành ngành đã chọn (từ đó không còn đánh dấu "tự nhận diện"). */
  function confirmAuto(list: RowView[]) {
    const upserts = list.flatMap((r) => {
      const g = fees?.suggestions[costKey(r.key)];
      return g ? [{ sku: r.key, category: g.path }] : [];
    });
    if (!upserts.length) return;
    void saveFees({ upserts }, `Đã xác nhận ngành hàng cho ${count(upserts.length)} sản phẩm.`);
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
      {fees && (
        <Card title="Ước tính phí sàn Shopee" aside={fees.available ? `biểu phí từ ${fees.tableFrom.split("-").reverse().join("/")}` : undefined}>
          <p className={styles.small} style={{ lineHeight: 1.6 }}>
            Khi file đơn hàng Shopee không có cột phí, Cerno ước tính phí sàn: Phí Cố Định theo ngành hàng của từng sản phẩm, Phí Xử Lý Giao Dịch {PROCESSING_FEE_PCT}% và Phí Hạ Tầng {INFRA_FEE_VND.toLocaleString("vi-VN")}đ mỗi đơn (đã gồm thuế). Đơn có phí trong file thì dùng đúng phí đó. Chưa tính: miễn phí 30 ngày đầu, Voucher Xtra, đồng tài trợ mã ưu đãi, PiShip. Số ước tính được đánh dấu rõ trong các trang lãi.
          </p>
          {!fees.available ? (
            <div className={styles.warn}><span>Chưa lưu được cài đặt: cần chạy migration <code>0018_shopee_fee_estimate.sql</code> trên Supabase.</span></div>
          ) : (
            <>
              <div className={styles.formRow}>
                <label className={styles.checkRow}>
                  <input type="checkbox" checked={feeForm.enabled} disabled={!canEditFees} onChange={(e) => setFeeForm((f) => ({ ...f, enabled: e.target.checked }))} />
                  <span>Bật ước tính phí sàn</span>
                </label>
                <select className={styles.input} value={feeForm.sellerType} disabled={!canEditFees} aria-label="Loại shop" onChange={(e) => setFeeForm((f) => ({ ...f, sellerType: e.target.value as SellerType }))}>
                  {SELLER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {feeForm.sellerType === "non_mall" && (
                  <label className={styles.checkRow}>
                    <input type="checkbox" checked={feeForm.newSeller} disabled={!canEditFees} onChange={(e) => setFeeForm((f) => ({ ...f, newSeller: e.target.checked }))} />
                    <span>Người bán mới (đăng sản phẩm đầu tiên từ 01/01 đến 31/05/2026): giảm Phí Cố Định 01/06 đến 31/08/2026</span>
                  </label>
                )}
                {canEditFees && (
                  <button className={`${styles.btn} ${styles.primary}`} disabled={!feeFormChanged || feeSaving} onClick={() => saveFees({ settings: feeForm }, "Đã lưu cài đặt ước tính phí sàn.")}>
                    {feeSaving ? "Đang lưu…" : "Lưu cài đặt"}
                  </button>
                )}
              </div>
              <p className={styles.small} style={{ marginTop: 10 }}>
                {`${count(chosenCount)} sản phẩm Shopee đã chọn ngành, ${count(autoCount)} tự nhận diện, ${count(shopeeRows.length - chosenCount - autoCount)} chưa xác định được ngành.`} Sản phẩm chưa có ngành thì đơn của nó chưa được ước tính phí.
              </p>
              {fees.settings.enabled && autoCount > 0 && (
                <div className={styles.note} style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 240 }}>
                    Cerno đã tự nhận diện ngành hàng cho <b>{count(autoCount)}</b> sản phẩm Shopee từ tên sản phẩm và đã dùng để ước tính phí, bạn không cần xác nhận từng sản phẩm. Lướt qua cột Ngành hàng bên dưới: ngành nào chưa đúng thì bấm Đổi (ngành khác thì phí cố định khác).
                  </span>
                  {canEditFees && <button className={styles.btn} disabled={feeSaving} onClick={() => confirmAuto(autoRows)}>Xác nhận tất cả</button>}
                </div>
              )}
            </>
          )}
        </Card>
      )}
      <FeeEstimateNote count={data.summary?.feeEstimated ?? 0} auto={autoCategoryCount(fees)} />
      {message && <div className={styles.note}>{message}</div>}
      {saveError && <ErrorBox message={saveError} />}

      <Card title="Sản phẩm" aside={`${count(shown.length)} sản phẩm · giá vốn là giá mỗi cái`}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ minWidth: 210 }}>Sản phẩm</th><th className={styles.r}>Đã bán</th><th className={styles.r}>Giá bán TB</th><th className={styles.r}>Giá vốn / cái</th>
                <th className={styles.r}>Phí sàn / đơn</th><th className={styles.r}>Quảng cáo / đơn</th><th className={styles.r}>Lãi mỗi đơn</th><th className={styles.r}>Giá hòa vốn</th>{fees?.available && (<><th style={{ minWidth: 260 }}>Ngành hàng</th><th className={styles.r}>Phí cố định</th><th /></>)}<th>Tình trạng</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const p = r.product;
                const value = edits[r.key] ?? toInput(r.catalogCost ?? p?.unitCost ?? null);
                const isMissing = missing(r);
                const chosen = fees?.categories[costKey(r.key)];
                const guess = chosen ? undefined : fees?.suggestions[costKey(r.key)];
                const cat = chosen ?? guess;
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
                    {fees?.available && (
                      <>
                        <td className={styles.catName}>
                          {!sold(r) ? (
                            <span className={styles.muted}>Không áp dụng (không bán trên Shopee)</span>
                          ) : cat ? (
                            <>
                              <span className={styles.catPath} title={cat.path} data-i18n-skip>{cat.path}</span>
                              <span className={`${styles.badge} ${guess ? styles.bWarn : styles.bPos}`}>{guess ? "Tự nhận diện" : "Đã chọn"}</span>
                            </>
                          ) : (
                            <span className={styles.muted}>Chưa xác định được ngành</span>
                          )}
                        </td>
                        <td className={styles.r}>{sold(r) && cat ? (cat.ratePct !== null ? ratePctText(cat.ratePct) : "Không có trong biểu phí") : "—"}</td>
                        <td className={styles.actions}>
                          {sold(r) && canEditFees && (
                            <>
                              <button className={styles.btn} disabled={feeSaving} onClick={() => setCatRow(r)}>{cat ? "Đổi" : "Chọn ngành"}</button>
                              {chosen && <button className={styles.btn} disabled={feeSaving} aria-label={`Bỏ ngành của ${r.name}`} onClick={() => void saveFees({ removes: [r.key] }, "Đã bỏ ngành hàng.")}>Bỏ</button>}
                            </>
                          )}
                        </td>
                      </>
                    )}
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
              {shown.length === 0 && <tr><td colSpan={fees?.available ? 12 : 9} className={styles.muted} style={{ textAlign: "center", padding: 28 }}>Không có sản phẩm nào.</td></tr>}
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
      {catRow && fees && (
        <CategoryDialog
          productName={catRow.name}
          sellerType={fees.settings.sellerType}
          canApplyAll={rows.some((r) => r.key !== catRow.key && sold(r) && !fees.categories[costKey(r.key)])}
          onPick={(path, all) => pickCategory(catRow, path, all)}
          onClose={() => setCatRow(null)}
        />
      )}
    </div>
  );
}
