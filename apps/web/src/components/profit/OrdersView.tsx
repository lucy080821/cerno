"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { OrderFilter, OrderProfit, OrderSort } from "@/lib/profit/order-profit";
import { Waterfall } from "./charts";
import { count, pct, signed, vnd } from "./format";
import { REASON_HINT, REASON_LABEL } from "./reasons";
import { Card, ErrorBox, Loading, NoOrders } from "./Shared";
import { PeriodBar } from "./PeriodBar";
import { usePeriod } from "@/lib/profit/period-store";
import { rangeQuery } from "./useProfit";
import styles from "./profit.module.css";

interface OrdersResponse {
  source: { id: string } | null;
  counts: Record<OrderFilter, number> | null;
  channels: string[];
  dataRange?: { min: string | null; max: string | null };
  total: number;
  page: number;
  pageSize: number;
  orders: OrderProfit[];
}

const FILTERS: { key: OrderFilter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "loss", label: "Đang lỗ" },
  { key: "thin", label: "Lãi dưới 5%" },
  { key: "missing", label: "Thiếu giá vốn" },
  { key: "return", label: "Hoàn và hủy" },
];

const productText = (o: OrderProfit) => {
  const first = o.lines[0];
  const name = first?.product ?? first?.sku ?? "—";
  return o.lines.length > 1 ? `${name} +${o.lines.length - 1}` : name;
};

function ProfitCell({ o }: { o: OrderProfit }) {
  if (o.profit === null) return <span className={`${styles.badge} ${styles.bWarn}`}>Chưa có giá vốn</span>;
  return <b className={o.profit < 0 ? styles.neg : styles.pos}>{signed(o.profit)}</b>;
}

/** Ngăn chi tiết: tiền của một đơn đi đâu, vì sao lỗ. */
function OrderDetail({ o, onClose }: { o: OrderProfit; onClose: () => void }) {
  const items = [
    { label: "Doanh thu", value: o.revenue + o.shippingIn, kind: "total" as const },
    { label: "Phí sàn", value: o.fee, kind: "neg" as const },
    { label: "Giá vốn", value: o.cost, kind: "neg" as const },
    { label: "Quảng cáo", value: o.adCost, kind: "neg" as const },
    ...(o.shipCost > 0 ? [{ label: "Ship shop chịu", value: o.shipCost, kind: "neg" as const }] : []),
    { label: "Lãi", value: 0, kind: "result" as const },
  ];
  return (
    <aside className={`${styles.card} ${styles.drawer}`} aria-label="Chi tiết lãi của đơn">
      <div className={styles.cardHead}>
        <div>
          <div className={styles.small}>Chi tiết lãi của đơn</div>
          <h2 data-i18n-skip>{o.hasId ? o.id : "Đơn không có mã"}</h2>
        </div>
        <button className={styles.btn} onClick={onClose}>Đóng</button>
      </div>
      <div className={styles.toolbar} style={{ marginBottom: 12 }}>
        <span className={styles.badge} data-i18n-skip>{o.channel}</span>
        {o.date && <span className={styles.badge}>{o.date}</span>}
        <span className={`${styles.badge} ${o.valid ? styles.bPos : styles.bNeg}`}>{o.status}</span>
      </div>
      <div className={styles.small}>Lãi của đơn này</div>
      {o.profit === null ? (
        <div className={styles.warn} style={{ margin: "6px 0 12px" }}>
          <span style={{ flex: 1 }}>Đơn có sản phẩm chưa có giá vốn nên chưa tính được lãi.</span>
          <Link href="/products?filter=missing" className={styles.btn}>Nhập giá vốn</Link>
        </div>
      ) : (
        <>
          <div className={`${styles.bigProfit} ${o.profit < 0 ? styles.neg : styles.pos}`}>{signed(o.profit)}</div>
          <div className={styles.small} style={{ marginBottom: 6 }}>Biên lãi {pct(o.margin)}</div>
          <Waterfall items={items} height={210} fmt={(n) => `${Math.round(n / 1000).toLocaleString("vi-VN")}K`} />
        </>
      )}
      <table className={styles.lines} style={{ marginTop: 8 }}>
        <tbody>
          {o.discount > 0 && <tr><td>Giảm giá đã trừ</td><td className={`${styles.r} ${styles.muted}`}>{vnd(o.discount)}</td></tr>}
          <tr><td>Doanh thu thực</td><td className={styles.r}><b>{vnd(o.revenue)}</b></td></tr>
          <tr><td>Phí vận chuyển khách trả</td><td className={`${styles.r} ${styles.pos}`}>+{vnd(o.shippingIn)}</td></tr>
          <tr><td>Phí sàn{o.feeEstimated && <span className={styles.muted}> (ước tính)</span>}</td><td className={`${styles.r} ${styles.neg}`}>-{vnd(o.fee)}</td></tr>
          <tr><td>Giá vốn</td><td className={`${styles.r} ${styles.neg}`}>{o.profit === null ? "?" : `-${vnd(o.cost)}`}</td></tr>
          <tr><td>Quảng cáo chia vào đơn</td><td className={`${styles.r} ${styles.neg}`}>-{vnd(o.adCost)}</td></tr>
          {o.shipCost > 0 && <tr><td>Phí ship shop chịu<span className={styles.muted}> (ước tính)</span></td><td className={`${styles.r} ${styles.neg}`}>-{vnd(o.shipCost)}</td></tr>}
        </tbody>
      </table>
      <div className={styles.small} style={{ margin: "14px 0 6px" }}>Sản phẩm trong đơn</div>
      <table className={styles.lines}>
        <tbody>
          {o.lines.map((l, i) => (
            <tr key={i}>
              <td data-i18n-skip>{l.product ?? l.sku ?? "—"}{l.variant ? ` · ${l.variant}` : ""} <span className={styles.muted}>×{l.quantity}</span></td>
              <td className={styles.r}>{vnd(l.revenue)}</td>
              <td className={`${styles.r} ${styles.muted}`}>{l.cost === null ? "chưa có giá vốn" : `vốn ${vnd(l.cost)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {o.reason && (
        <div className={styles.note} style={{ marginTop: 14 }}>
          <b>Vì sao đơn này lỗ: {REASON_LABEL[o.reason]}.</b> {REASON_HINT[o.reason]}
        </div>
      )}
    </aside>
  );
}

export function OrdersView({ initialFilter }: { initialFilter: OrderFilter }) {
  const [period] = usePeriod();
  const range = rangeQuery(period);
  const [filter, setFilter] = useState<OrderFilter>(initialFilter);
  const [sort, setSort] = useState<OrderSort>("date");
  const [channel, setChannel] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OrderProfit | null>(null);

  // Gõ tìm kiếm: chờ 300ms rồi mới gọi server.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [filter, sort, channel, query, range]);

  const params = useMemo(
    () => new URLSearchParams({ filter, sort, page: String(page), ...(channel ? { channel } : {}), ...(query ? { q: query } : {}) }).toString() + (range ? `&${range}` : ""),
    [filter, sort, page, channel, query, range],
  );
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetch(`/api/profit/orders?${params}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) setError(json.error ?? "Không tải được danh sách đơn.");
        else setData(json as OrdersResponse);
      })
      .catch(() => alive && setError("Lỗi mạng, thử lại sau."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [params, tick]);

  if (!data && loading) return <Loading />;
  if (error && !data) return <ErrorBox message={error} retry={() => setTick((n) => n + 1)} />;
  if (data && !data.source) return <NoOrders />;
  if (!data) return null;

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className={selected ? styles.layoutWithDrawer : styles.stack}>
      <div className={styles.stack}>
        <PeriodBar dataMin={data.dataRange?.min} dataMax={data.dataRange?.max} />
        <div className={styles.toolbar}>
          {FILTERS.map((f) => (
            <button key={f.key} className={`${styles.chip} ${filter === f.key ? styles.chipOn : ""}`} onClick={() => setFilter(f.key)}>
              {f.label} <b>{data.counts ? count(data.counts[f.key]) : ""}</b>
            </button>
          ))}
        </div>
        <div className={styles.toolbar}>
          <input className={styles.input} style={{ flex: "1 1 220px" }} placeholder="Tìm mã đơn, SKU, tên sản phẩm…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm đơn" />
          <select className={styles.input} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Kênh">
            <option value="">Mọi kênh</option>
            {data.channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={styles.input} value={sort} onChange={(e) => setSort(e.target.value as OrderSort)} aria-label="Sắp xếp">
            <option value="date">Mới nhất trước</option>
            <option value="profit">Lỗ nhiều nhất trước</option>
          </select>
        </div>
        <Card title="Lãi từng đơn" aside={loading ? "Đang tải…" : `${count(data.total)} đơn`}>
          {error && <ErrorBox message={error} retry={() => setTick((n) => n + 1)} />}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Đơn</th><th>Sản phẩm</th><th className={styles.r}>Doanh thu</th><th className={styles.r}>Chi phí</th><th className={styles.r}>Lãi đơn</th><th className={styles.r}>Biên</th></tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr
                    key={`${o.channel}|${o.id}`}
                    className={`${styles.clickRow} ${o.profit !== null && o.profit < 0 ? styles.lossRow : ""} ${selected && selected.id === o.id && selected.channel === o.channel ? styles.selRow : ""}`}
                    onClick={() => setSelected(o)}
                  >
                    <td><b data-i18n-skip>{o.hasId ? o.id : "—"}</b><span className={styles.sub}><span data-i18n-skip>{o.channel}</span> · {o.date ?? "—"} · {o.status}</span></td>
                    <td data-i18n-skip style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{productText(o)}</td>
                    <td className={styles.r}>{vnd(o.revenue)}</td>
                    <td className={`${styles.r} ${styles.muted}`} title={o.feeEstimated ? "Có phí sàn ước tính" : undefined}>{o.profit === null ? "—" : `${o.feeEstimated ? "≈ " : ""}${vnd(o.fee + o.cost + o.adCost + o.shipCost)}`}</td>
                    <td className={styles.r}><ProfitCell o={o} /></td>
                    <td className={`${styles.r} ${o.margin !== null && o.margin < 0 ? styles.neg : styles.muted}`}>{pct(o.margin, 0)}</td>
                  </tr>
                ))}
                {data.orders.length === 0 && (
                  <tr><td colSpan={6} className={styles.muted} style={{ textAlign: "center", padding: 28 }}>Không có đơn nào khớp bộ lọc.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className={styles.pager}>
            <span>Trang {page} / {pages} · bấm một đơn để xem tiền đi đâu</span>
            <span className={styles.toolbar}>
              <button className={styles.btn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Trước</button>
              <button className={styles.btn} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Sau</button>
            </span>
          </div>
        </Card>
      </div>
      {selected && <OrderDetail o={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
