"use client";

import { useEffect, useMemo, useState } from "react";
import { parseNumber } from "@/lib/google/parse-number";
import { costKey, parentKeys, parseCostPaste, type CostEntry } from "@/lib/profit/catalog";
import type { ProductProfit } from "@/lib/profit/order-profit";
import { count, signed, vnd } from "./format";
import {
  DEFAULT_FEE_SETTINGS, FEE_PLATFORMS, INFRA_FEE_VND, MAX_AFFILIATE_PCT, PROCESSING_FEE_PCT, SELLER_TYPES, TIKTOK_DEFAULT_RATE_PCT, TIKTOK_PROCESSING_VND, TIKTOK_TRANSACTION_PCT,
  type FeePlatform, type FeeSettings, type SellerType,
} from "@/lib/fees/constants";
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
  // Ước tính phí sàn (Shopee, TikTok Shop): bản nháp cài đặt, sản phẩm + sàn đang chọn ngành, trạng thái lưu.
  const [feeForm, setFeeForm] = useState<FeeSettings>(DEFAULT_FEE_SETTINGS);
  const [affiliateText, setAffiliateText] = useState("");
  const [catPlatform, setCatPlatform] = useState<"all" | FeePlatform>("all");
  const [catTarget, setCatTarget] = useState<{ row: RowView; platform: FeePlatform } | null>(null);
  const [feeSaving, setFeeSaving] = useState(false);
  const fees = data?.fees;
  useEffect(() => {
    if (fees?.settings) {
      setFeeForm(fees.settings);
      setAffiliateText(fees.settings.tiktokAffiliatePct ? String(fees.settings.tiktokAffiliatePct) : "");
    }
  }, [fees?.settings.enabled, fees?.settings.sellerType, fees?.settings.newSeller, fees?.settings.tiktokSellerType, fees?.settings.tiktokAffiliatePct]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Ngành hàng chỉ có nghĩa với sản phẩm bán trên sàn đó (chỉ Shopee và TikTok Shop có biểu phí để ước tính); sản phẩm chưa có đơn vẫn coi là áp dụng.
  const soldOn = (r: RowView, p: FeePlatform) => !r.product || r.product.channels.includes(p);
  const catOf = (r: RowView, p: FeePlatform) => fees?.platforms[p].categories[costKey(r.key)];
  const guessOf = (r: RowView, p: FeePlatform) => (catOf(r, p) ? undefined : fees?.platforms[p].suggestions[costKey(r.key)]);
  // Với mỗi sàn: sản phẩm đã chọn ngành, và sản phẩm Cerno đã tự nhận diện từ tên (đã dùng để ước tính phí, người bán chỉ cần lướt qua).
  const stats = (p: FeePlatform) => {
    const list = rows.filter((r) => soldOn(r, p));
    const chosen = list.filter((r) => catOf(r, p)).length;
    const auto = list.filter((r) => guessOf(r, p));
    return { total: list.length, chosen, auto, unknown: list.length - chosen - auto.length };
  };
  const catRows = rows.flatMap((r) => FEE_PLATFORMS.filter((pl) => (catPlatform === "all" || catPlatform === pl) && soldOn(r, pl) && !!r.product).map((pl) => ({ row: r, platform: pl })));
  const shopeeStats = stats("Shopee");
  const tiktokStats = stats("TikTok Shop");
  const autoCount = shopeeStats.auto.length + tiktokStats.auto.length;
  const affiliateValue = affiliateText.trim() === "" ? 0 : parseNumber(affiliateText);
  const affiliateOk = affiliateValue !== null && affiliateValue >= 0 && affiliateValue <= MAX_AFFILIATE_PCT;
  const formToSave: FeeSettings = { ...feeForm, tiktokAffiliatePct: affiliateOk ? (affiliateValue as number) : feeForm.tiktokAffiliatePct };
  const feeFormChanged =
    !!fees &&
    (formToSave.enabled !== fees.settings.enabled || formToSave.sellerType !== fees.settings.sellerType || formToSave.newSeller !== fees.settings.newSeller ||
      formToSave.tiktokSellerType !== fees.settings.tiktokSellerType || formToSave.tiktokAffiliatePct !== fees.settings.tiktokAffiliatePct);

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
  async function saveFees(body: { settings?: FeeSettings; platform?: FeePlatform; upserts?: { sku: string; category: string }[]; removes?: string[] }, okText: string) {
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

  function pickCategory(row: RowView, platform: FeePlatform, path: string, applyAll: boolean) {
    setCatTarget(null);
    const targets = applyAll ? rows.filter((r) => r.key === row.key || (soldOn(r, platform) && !catOf(r, platform))) : [row];
    void saveFees({ platform, upserts: targets.map((r) => ({ sku: r.key, category: path })) }, `Đã chọn ngành cho ${count(targets.length)} sản phẩm.`);
  }

  /** Người bán xác nhận ngành Cerno đã tự nhận diện: lưu thành ngành đã chọn (từ đó không còn đánh dấu "tự nhận diện"). */
  function confirmAuto(platform: FeePlatform) {
    const upserts = rows.flatMap((r) => {
      const g = soldOn(r, platform) ? guessOf(r, platform) : undefined;
      return g ? [{ sku: r.key, category: g.path }] : [];
    });
    if (!upserts.length) return;
    void saveFees({ platform, upserts }, `Đã xác nhận ngành hàng cho ${count(upserts.length)} sản phẩm.`);
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
      else {
        // Mã gốc (AO-001) áp dụng cho mọi biến thể (AO-001-AE, AO-001_DO) đang có trong đơn hàng.
        const kids = rows.filter((r) => parentKeys(r.key).includes(costKey(it.sku)));
        for (const r of kids) next[r.key] = String(it.unitCost);
        if (!kids.length) unknown++;
      }
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
        <Card title="Ước tính phí sàn" aside={fees.available ? `Shopee từ ${fees.platforms.Shopee.tableFrom.split("-").reverse().join("/")} · TikTok Shop từ ${fees.platforms["TikTok Shop"].tableFrom.split("-").reverse().join("/")}` : undefined}>
          <p className={styles.small} style={{ lineHeight: 1.6 }}>
            Khi file đơn hàng của Shopee hoặc TikTok Shop không có cột phí, Cerno ước tính phí sàn. Shopee: Phí Cố Định theo ngành hàng của từng sản phẩm, Phí Xử Lý Giao Dịch {PROCESSING_FEE_PCT}% và Phí Hạ Tầng {INFRA_FEE_VND.toLocaleString("vi-VN")}đ mỗi đơn (đã gồm thuế). TikTok Shop: Phí Hoa Hồng Nền Tảng theo ngành hàng, Phí Giao Dịch {TIKTOK_TRANSACTION_PCT}% và Phí Xử Lý Đơn Hàng {TIKTOK_PROCESSING_VND.toLocaleString("vi-VN")}đ mỗi đơn (đã gồm thuế). Đơn có phí trong file thì dùng đúng phí đó. Số ước tính được đánh dấu rõ trong các trang lãi. Lazada và Tiki chưa có biểu phí để nhập sẵn: bạn tự nhập tỷ lệ ở trang Chi phí.
          </p>
          {!fees.available ? (
            <div className={styles.warn}><span>Chưa lưu được cài đặt: cần chạy migration <code>0018_shopee_fee_estimate.sql</code> trên Supabase.</span></div>
          ) : (
            <>
              {!fees.multiPlatform && (
                <div className={styles.warn}><span>Để ước tính phí TikTok Shop và chọn ngành hàng riêng cho từng sàn, cần chạy migration <code>0021_multi_platform_fees.sql</code> trên Supabase.</span></div>
              )}
              <div className={styles.formRow}>
                <label className={styles.checkRow}>
                  <input type="checkbox" checked={feeForm.enabled} disabled={!canEditFees} onChange={(e) => setFeeForm((f) => ({ ...f, enabled: e.target.checked }))} />
                  <span>Bật ước tính phí sàn</span>
                </label>
              </div>
              <div className={styles.formRow}>
                <b>Shopee</b>
                <select className={styles.input} value={feeForm.sellerType} disabled={!canEditFees} aria-label="Loại shop Shopee" onChange={(e) => setFeeForm((f) => ({ ...f, sellerType: e.target.value as SellerType }))}>
                  {SELLER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {feeForm.sellerType === "non_mall" && (
                  <label className={styles.checkRow}>
                    <input type="checkbox" checked={feeForm.newSeller} disabled={!canEditFees} onChange={(e) => setFeeForm((f) => ({ ...f, newSeller: e.target.checked }))} />
                    <span>Người bán mới (đăng sản phẩm đầu tiên từ 01/01 đến 31/05/2026): giảm Phí Cố Định 01/06 đến 31/08/2026</span>
                  </label>
                )}
              </div>
              <div className={styles.formRow}>
                <b>TikTok Shop</b>
                <select className={styles.input} value={feeForm.tiktokSellerType} disabled={!canEditFees || !fees.multiPlatform} aria-label="Loại shop TikTok Shop" onChange={(e) => setFeeForm((f) => ({ ...f, tiktokSellerType: e.target.value as SellerType }))}>
                  <option value="non_mall">Shop thường (nhà bán hàng tiêu chuẩn)</option>
                  <option value="mall">TikTok Shop Mall</option>
                </select>
                <label className={styles.checkRow}>
                  <span>Hoa hồng affiliate trung bình (% giá trị sản phẩm)</span>
                  <input className={`${styles.input} ${styles.costInput}`} inputMode="decimal" placeholder="0" aria-label="Hoa hồng affiliate trung bình" value={affiliateText} disabled={!canEditFees || !fees.multiPlatform} onChange={(e) => setAffiliateText(e.target.value)} />
                </label>
              </div>
              {!affiliateOk && <p className={styles.neg} role="alert">Hoa hồng affiliate phải là số từ 0 đến {MAX_AFFILIATE_PCT}.</p>}
              {canEditFees && (
                <div className={styles.formRow}>
                  <button className={`${styles.btn} ${styles.primary}`} disabled={!feeFormChanged || feeSaving || !affiliateOk} onClick={() => saveFees({ settings: formToSave }, "Đã lưu cài đặt ước tính phí sàn.")}>
                    {feeSaving ? "Đang lưu…" : "Lưu cài đặt"}
                  </button>
                </div>
              )}
              <p className={styles.small} style={{ marginTop: 10 }}>
                {`Shopee: ${count(shopeeStats.chosen)} sản phẩm đã chọn ngành, ${count(shopeeStats.auto.length)} tự nhận diện, ${count(shopeeStats.unknown)} chưa xác định được ngành (đơn của chúng chưa được ước tính phí). `}
                {`TikTok Shop: ${count(tiktokStats.chosen)} đã chọn ngành, ${count(tiktokStats.auto.length)} tự nhận diện, ${count(tiktokStats.unknown)} chưa xác định (tính theo mức phí mặc định ${TIKTOK_DEFAULT_RATE_PCT[feeForm.tiktokSellerType]}%).`}
              </p>
              {fees.settings.enabled && autoCount > 0 && (
                <div className={styles.note} style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 240 }}>
                    Cerno đã tự nhận diện ngành hàng cho <b>{count(autoCount)}</b> sản phẩm từ tên sản phẩm và đã dùng để ước tính phí, bạn không cần xác nhận từng sản phẩm. Lướt qua cột Ngành hàng bên dưới: ngành nào chưa đúng thì bấm Đổi (ngành khác thì mức phí khác).
                  </span>
                  {canEditFees && shopeeStats.auto.length > 0 && <button className={styles.btn} disabled={feeSaving} onClick={() => confirmAuto("Shopee")}>Xác nhận tất cả (Shopee)</button>}
                  {canEditFees && tiktokStats.auto.length > 0 && <button className={styles.btn} disabled={feeSaving} onClick={() => confirmAuto("TikTok Shop")}>Xác nhận tất cả (TikTok Shop)</button>}
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
                <th style={{ minWidth: 210 }}>Sản phẩm</th><th>Sàn</th><th className={styles.r}>Đã bán</th><th className={styles.r}>Giá bán TB</th><th className={styles.r}>Giá vốn / cái</th>
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
                    <td><div className={styles.tags}>{p && p.channels.length ? p.channels.map((c) => <span key={c} className={styles.platformTag}>{c}</span>) : <span className={styles.muted}>—</span>}</div></td>
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
              {shown.length === 0 && <tr><td colSpan={10} className={styles.muted} style={{ textAlign: "center", padding: 28 }}>Không có sản phẩm nào.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {fees?.available && (
        <Card title="Ngành hàng tính phí" aside={`${count(catRows.length)} dòng · mỗi dòng là một sản phẩm trên một sàn`}>
          <div className={styles.toolbar}>
            {([["all", "Tất cả"], ...FEE_PLATFORMS.map((pl) => [pl, pl])] as ["all" | FeePlatform, string][]).map(([k, label]) => (
              <button key={k} className={`${styles.chip} ${catPlatform === k ? styles.chipOn : ""}`} onClick={() => setCatPlatform(k)}>{label}</button>
            ))}
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th style={{ minWidth: 190 }}>Sản phẩm</th><th>Sàn</th><th style={{ minWidth: 320 }}>Ngành hàng</th><th className={styles.r}>Mức phí</th><th>Nguồn</th><th /></tr>
              </thead>
              <tbody>
                {catRows.slice(0, 300).map(({ row: r, platform: pl }) => {
                  const chosen = catOf(r, pl);
                  const guess = guessOf(r, pl);
                  const cat = chosen ?? guess;
                  const usable = pl === "Shopee" || fees.multiPlatform;
                  const dflt = pl === "TikTok Shop" ? TIKTOK_DEFAULT_RATE_PCT[fees.settings.tiktokSellerType] : null;
                  return (
                    <tr key={`${r.key}|${pl}`}>
                      <td><b data-i18n-skip>{r.name}</b>{r.sku && r.sku !== r.name && <span className={styles.sub} data-i18n-skip>{r.sku}</span>}</td>
                      <td><span className={styles.platformTag}>{pl}</span></td>
                      <td>{cat ? <span title={cat.path} data-i18n-skip>{cat.path}</span> : <span className={styles.muted}>Chưa xác định được ngành</span>}</td>
                      <td className={styles.r}>
                        {cat ? (cat.ratePct !== null ? ratePctText(cat.ratePct) : <span className={styles.muted}>Không có trong biểu phí</span>) : dflt !== null ? <span className={styles.muted}>{`${dflt}% (mặc định)`}</span> : "—"}
                      </td>
                      <td>{cat ? <span className={`${styles.badge} ${guess ? styles.bWarn : styles.bPos}`}>{guess ? "Tự nhận diện" : "Đã chọn"}</span> : <span className={styles.muted}>—</span>}</td>
                      <td className={styles.actions}>
                        {canEditFees && usable && (
                          <>
                            <button className={styles.btn} disabled={feeSaving} onClick={() => setCatTarget({ row: r, platform: pl })}>{cat ? "Đổi" : "Chọn ngành"}</button>
                            {chosen && fees.platforms[pl].categories[costKey(r.key)] && <button className={styles.btn} disabled={feeSaving} aria-label={`Bỏ ngành của ${r.name}`} onClick={() => void saveFees({ platform: pl, removes: [r.key] }, "Đã bỏ ngành hàng.")}>Bỏ</button>}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {catRows.length === 0 && <tr><td colSpan={6} className={styles.muted} style={{ textAlign: "center", padding: 28 }}>Chưa có sản phẩm bán trên Shopee hoặc TikTok Shop.</td></tr>}
              </tbody>
            </table>
          </div>
          {catRows.length > 300 && <p className={styles.small} style={{ marginTop: 10 }}>{`Hiển thị 300 dòng đầu trong ${count(catRows.length)} dòng. Chọn một sàn ở trên để thu hẹp.`}</p>}
        </Card>
      )}

      <div className={styles.grid2}>
        <Card title="Giá hòa vốn là gì?">
          <p className={styles.small} style={{ lineHeight: 1.6 }}>Là giá bán mỗi cái thấp nhất để đơn không lỗ, đã tính giá vốn, phí sàn và quảng cáo chia vào đơn (trừ đi phí ship khách trả). Giá bán trung bình thấp hơn giá hòa vốn nghĩa là mỗi đơn bán ra đang mất tiền.</p>
        </Card>
        <Card title="Giá vốn được dùng thế nào?">
          <p className={styles.small} style={{ lineHeight: 1.6 }}>Giá vốn nhập ở đây được ghi vào cột &quot;Giá vốn&quot; của nguồn Đơn hàng đa kênh (giá mỗi cái × số lượng; đơn hủy và hoàn trả là 0), nên mọi dashboard và báo cáo đều thấy. Giá ở đây thay cho giá vốn có sẵn trong file. Áp dụng cho cả đơn cũ và các file tải lên sau này.</p>
        </Card>
      </div>
      {catTarget && fees && (
        <CategoryDialog
          productName={catTarget.row.name}
          platform={catTarget.platform}
          sellerType={fees.platforms[catTarget.platform].sellerType}
          canApplyAll={rows.some((r) => r.key !== catTarget.row.key && soldOn(r, catTarget.platform) && !catOf(r, catTarget.platform))}
          onPick={(path, all) => pickCategory(catTarget.row, catTarget.platform, path, all)}
          onClose={() => setCatTarget(null)}
        />
      )}
    </div>
  );
}
