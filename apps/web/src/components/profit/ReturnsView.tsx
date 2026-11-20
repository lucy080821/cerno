"use client";

import { useEffect, useState } from "react";
import type { OrderProfit } from "@/lib/profit/order-profit";
import { compact, count, pct, signed, vnd } from "./format";
import { Card, ErrorBox, Kpi, Loading, NoOrders } from "./Shared";
import { useProfitSummary } from "./useProfit";
import styles from "./profit.module.css";

/** Trang Hoàn và hủy: đơn hoàn/hủy làm shop mất bao nhiêu (theo dữ liệu đang có). */
export function ReturnsView() {
  const { data, error, loading, reload } = useProfitSummary();
  const [orders, setOrders] = useState<OrderProfit[] | null>(null);
  const [listError, setListError] = useState("");
  useEffect(() => {
    if (!data?.source) return;
    fetch("/api/profit/orders?filter=return&sort=profit", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) setListError(json.error ?? "Không tải được danh sách đơn.");
        else setOrders((json.orders ?? []) as OrderProfit[]);
      })
      .catch(() => setListError("Lỗi mạng, thử lại sau."));
  }, [data?.source]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} retry={reload} />;
  if (!data) return null;
  if (!data.source || !data.summary) return <NoOrders />;
  const s = data.summary;
  const bad = s.returned + s.cancelled;

  return (
    <div className={styles.stack}>
      <div className={styles.kpis}>
        <Kpi label="Đơn hoàn hàng" value={count(s.returned)} tone={s.returned ? "neg" : undefined} note={`Mất ${compact(-s.returnLoss)} (phí sàn và quảng cáo)`} />
        <Kpi label="Đơn hủy" value={count(s.cancelled)} tone={s.cancelled ? "neg" : undefined} note={`Mất ${compact(-s.cancelLoss)} tiền quảng cáo`} />
        <Kpi label="Tỷ lệ hoàn và hủy" value={pct(s.orders ? bad / s.orders : null)} note={`${count(bad)} trên ${count(s.orders)} đơn`} />
        <Kpi label="Mất mỗi đơn hoàn/hủy" value={vnd(bad ? (s.returnLoss + s.cancelLoss) / bad : null)} note="Chỉ tính phần dữ liệu có trong file" />
      </div>
      <div className={styles.note}>
        Đơn hủy chỉ mất tiền quảng cáo đã chi. Đơn hoàn tiền còn bị sàn thu phí (Shopee vẫn thu Phí Cố Định, Phí Xử Lý Giao Dịch và Phí Hạ Tầng khi đơn trả hàng được hoàn tiền ngay), nên được tính cả phí ghi trong file. <b>Phí ship hai chiều và phí xử lý đơn hoàn chưa có trong file đơn hàng</b> nên chưa được trừ, số mất thật có thể cao hơn. Hãy giữ video đóng gói và video mở hàng hoàn để khiếu nại khi bị tráo hàng.
      </div>
      <Card title="Đơn hoàn và hủy" aside="sắp xếp theo mức mất">
        {listError && <ErrorBox message={listError} />}
        {!orders && !listError && <Loading />}
        {orders && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Đơn</th><th>Sản phẩm</th><th>Tình trạng</th><th>Trạng thái trên sàn</th><th className={styles.r}>Phí sàn bị thu</th><th className={styles.r}>Quảng cáo đã chi</th><th className={styles.r}>Mất</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={`${o.channel}|${o.id}`}>
                    <td><b data-i18n-skip>{o.hasId ? o.id : "—"}</b><span className={styles.sub}><span data-i18n-skip>{o.channel}</span> · {o.date ?? "—"}</span></td>
                    <td data-i18n-skip>{o.lines.map((l) => l.product ?? l.sku).filter(Boolean).join(", ") || "—"}</td>
                    <td><span className={`${styles.badge} ${o.status === "Hoàn trả" ? styles.bNeg : ""}`}>{o.status}</span></td>
                    <td className={styles.muted} data-i18n-skip>{o.rawStatus ?? "—"}</td>
                    <td className={styles.r}>{vnd(o.fee)}</td>
                    <td className={styles.r}>{vnd(o.adCost)}</td>
                    <td className={styles.r}><b className={o.profit && o.profit < 0 ? styles.neg : styles.muted}>{signed(o.profit)}</b></td>
                  </tr>
                ))}
                {orders.length === 0 && <tr><td colSpan={7} className={styles.muted} style={{ textAlign: "center", padding: 28 }}>Không có đơn hoàn hay hủy nào.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.small} style={{ marginTop: 10 }}>Hiện tối đa 50 đơn mất nhiều nhất.</p>
      </Card>
    </div>
  );
}
