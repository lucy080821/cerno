"use client";

import Link from "next/link";
import { DayBars, HBars, Histogram, Waterfall } from "./charts";
import { compact, count, pct, signed, vnd } from "./format";
import { REASON_LABEL } from "./reasons";
import { Card, ErrorBox, FeeEstimateNote, Kpi, Loading, MissingCostNote, NoOrders } from "./Shared";
import { useProfitSummary } from "./useProfit";
import styles from "./profit.module.css";

/** Trang Lãi lỗ: tiền đi đâu, đơn nào lỗ và vì sao, lãi theo ngày, kênh, sản phẩm. */
export function ProfitView() {
  const { data, error, loading, reload } = useProfitSummary();
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} retry={reload} />;
  if (!data) return null;
  if (!data.source || !data.summary) return <NoOrders />;
  const s = data.summary;
  if (s.orders === 0) return <NoOrders />;

  return (
    <div className={styles.stack}>
      <MissingCostNote missing={s.missingCost} total={s.orders} />
      <FeeEstimateNote count={s.feeEstimated} />
      <div className={styles.kpis}>
        <Kpi label="Lãi thật" value={compact(s.profit)} tone={s.profit < 0 ? "neg" : "pos"} note={`Trên ${count(s.computable)} đơn đã đủ dữ liệu`} />
        <Kpi label="Lãi trung bình mỗi đơn" value={vnd(s.avgProfit)} note={`Biên lãi ${pct(s.margin)}`} />
        <Kpi label="Đơn đang lỗ" value={count(s.loss)} tone={s.loss ? "neg" : undefined} note={`Mất ${compact(-s.lossAmount)}`} />
        <Kpi label="Đơn lãi dưới 5%" value={count(s.thin)} note="Bán thêm gần như không có lãi" />
      </div>
      <div className={styles.grid2}>
        <Card title="Từ doanh thu đến lãi thật" aside={s.dateMin && s.dateMax ? `${s.dateMin} → ${s.dateMax}` : undefined}>
          <Waterfall
            items={[
              { label: "Doanh thu", value: s.revenue, kind: "total" },
              { label: "Ship khách trả", value: s.shippingIn, kind: "pos" },
              { label: "Phí sàn", value: s.fee, kind: "neg" },
              { label: "Giá vốn", value: s.cost, kind: "neg" },
              { label: "Quảng cáo", value: s.adCost, kind: "neg" },
              { label: "Lãi thật", value: 0, kind: "result" },
            ]}
          />
        </Card>
        <Card title={`Vì sao ${count(s.loss)} đơn bị lỗ?`} aside={`tổng mất ${compact(-s.lossAmount)}`}>
          {s.reasons.length === 0 ? (
            <p className={styles.small}>Chưa có đơn nào lỗ.</p>
          ) : (
            <HBars userLabels={false} rows={s.reasons.map((r) => ({ label: REASON_LABEL[r.reason], value: r.amount, text: `${count(r.orders)} đơn · ${compact(r.amount)}`, tone: "neg" as const }))} />
          )}
          <p className={styles.small} style={{ marginTop: 14 }}>Xem từng đơn ở trang <Link href="/orders?filter=loss">Đơn hàng</Link>. Phí ship hai chiều của đơn hoàn chưa có trong file đơn hàng nên chưa được tính.</p>
        </Card>
      </div>
      <div className={styles.grid2}>
        <Card title="Lãi mỗi ngày"><DayBars data={s.daily} /></Card>
        <Card title="Phân bố lãi theo đơn" aside="số đơn theo mức lãi mỗi đơn"><Histogram bins={s.histogram} /></Card>
      </div>
      <Card title="Lãi theo kênh">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Kênh</th><th className={styles.r}>Đơn</th><th className={styles.r}>Lãi</th><th className={styles.r}>Lãi mỗi đơn</th><th className={styles.r}>Tỷ lệ đơn lỗ</th></tr></thead>
            <tbody>
              {s.channels.map((c) => (
                <tr key={c.channel}>
                  <td data-i18n-skip><b>{c.channel}</b></td>
                  <td className={styles.r}>{count(c.orders)}</td>
                  <td className={styles.r}><b className={c.profit < 0 ? styles.neg : undefined}>{compact(c.profit)}</b></td>
                  <td className={styles.r}>{vnd(c.avgProfit)}</td>
                  <td className={`${styles.r} ${c.lossShare !== null && c.lossShare > 0.15 ? styles.neg : styles.muted}`}>{pct(c.lossShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Lãi theo sản phẩm" aside="phí sàn và quảng cáo của đơn chia cho sản phẩm theo doanh thu">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Sản phẩm</th><th className={styles.r}>Đơn</th><th className={styles.r}>Doanh thu</th><th className={styles.r}>Giá vốn</th><th className={styles.r}>Phí sàn</th><th className={styles.r}>Quảng cáo</th><th className={styles.r}>Lãi</th><th className={styles.r}>Lãi mỗi đơn</th></tr></thead>
            <tbody>
              {s.products.slice(0, 30).map((p) => (
                <tr key={p.key} className={p.profit !== null && p.profit < 0 ? styles.lossRow : ""}>
                  <td data-i18n-skip><b>{p.name}</b></td>
                  <td className={styles.r}>{count(p.orders)}</td>
                  <td className={styles.r}>{vnd(p.revenue)}</td>
                  <td className={`${styles.r} ${styles.muted}`}>{p.profit === null ? "?" : vnd(p.cost)}</td>
                  <td className={`${styles.r} ${styles.muted}`}>{vnd(p.fee)}</td>
                  <td className={`${styles.r} ${styles.muted}`}>{vnd(p.adCost)}</td>
                  <td className={styles.r}>{p.profit === null ? <span className={`${styles.badge} ${styles.bWarn}`}>Thiếu giá vốn</span> : <b className={p.profit < 0 ? styles.neg : styles.pos}>{signed(p.profit)}</b>}</td>
                  <td className={styles.r}>{signed(p.profitPerOrder)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
