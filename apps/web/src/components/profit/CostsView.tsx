"use client";

import Link from "next/link";
import { AdSpendCard } from "./AdSpendCard";
import { HBars } from "./charts";
import { compact, count, pct, vnd } from "./format";
import { Card, ErrorBox, FeeEstimateNote, Kpi, Loading, MissingCostNote, NoOrders } from "./Shared";
import { useProfitSummary } from "./useProfit";
import styles from "./profit.module.css";

/** Trang Chi phí: tiền đang đi vào đâu (giá vốn, phí sàn, quảng cáo), tỷ lệ trên doanh thu, theo sản phẩm. */
export function CostsView() {
  const { data, error, loading, reload } = useProfitSummary();
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} retry={reload} />;
  if (!data) return null;
  if (!data.source || !data.summary || data.summary.orders === 0) return <NoOrders />;
  const s = data.summary;
  const share = (n: number) => pct(s.revenue ? n / s.revenue : null);
  const lostAds = -(s.returnLoss + s.cancelLoss);
  const total = s.cost + s.fee + s.adCost;
  const products = s.products
    .filter((p) => p.profit !== null && p.revenue > 0)
    .sort((a, b) => b.cost + b.fee + b.adCost - (a.cost + a.fee + a.adCost))
    .slice(0, 30);

  return (
    <div className={styles.stack}>
      <MissingCostNote missing={s.missingCost} total={s.orders} />
      <FeeEstimateNote count={s.feeEstimated} />
      <div className={styles.kpis}>
        <Kpi label="Tổng chi phí" value={compact(total)} note={`${share(total)} doanh thu thực`} />
        <Kpi label="Giá vốn" value={compact(s.cost)} note={`${share(s.cost)} doanh thu thực`} />
        <Kpi label="Phí sàn" value={compact(s.fee)} note={`${share(s.fee)} doanh thu thực`} />
        <Kpi label="Quảng cáo" value={compact(s.adCost)} note={`${share(s.adCost)} doanh thu thực`} />
      </div>
      <div className={styles.grid2}>
        <Card title="Doanh thu thực đi đâu" aside={`trên ${count(s.computable)} đơn đã đủ dữ liệu`}>
          <HBars
            userLabels={false}
            rows={[
              { label: "Giá vốn", value: s.cost, text: `${compact(s.cost)} · ${share(s.cost)}`, tone: "base" as const },
              { label: "Phí sàn", value: s.fee, text: `${compact(s.fee)} · ${share(s.fee)}`, tone: "neg" as const },
              { label: "Quảng cáo", value: s.adCost, text: `${compact(s.adCost)} · ${share(s.adCost)}`, tone: "neg" as const },
              { label: "Lãi thật", value: Math.max(0, s.profit), text: `${compact(s.profit)} · ${share(s.profit)}`, tone: "pos" as const },
            ]}
          />
          <p className={styles.small} style={{ marginTop: 12 }}>Doanh thu thực đã trừ đơn hủy và hoàn trả. Phí ship khách trả ({compact(s.shippingIn)}) được cộng vào lãi.</p>
        </Card>
        <Card title="Chi phí chưa thấy trong file">
          <ul className={styles.listPlain}>
            <li>Quảng cáo đã chi cho đơn hủy và hoàn: <b>{compact(lostAds)}</b> (đã tính vào lãi thật).</li>
            <li>Chi phí quảng cáo: nhập ở khung "Chi phí quảng cáo" bên dưới nếu file đơn hàng không có cột này.</li>
            <li>Phí ship hai chiều và phí xử lý đơn hoàn: file đơn hàng của sàn chưa có số này.</li>
            <li>Đóng gói, nhân công, mặt bằng: chưa nhập được, sẽ có ở bản sau.</li>
            <li>Giá vốn: lấy từ trang <Link href="/products">Sản phẩm và giá vốn</Link>, sản phẩm chưa có giá vốn thì đơn đó chưa tính lãi.</li>
          </ul>
        </Card>
      </div>
      <AdSpendCard editable={data.editable} adCostInOrders={s.adCost} onChanged={() => void reload()} />
      <Card title="Chi phí theo sản phẩm" aside="phí sàn và quảng cáo của đơn chia cho sản phẩm theo doanh thu">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Sản phẩm</th><th className={styles.r}>Doanh thu</th><th className={styles.r}>Giá vốn</th><th className={styles.r}>Phí sàn</th><th className={styles.r}>Quảng cáo</th><th className={styles.r}>Chi phí / doanh thu</th></tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.key}>
                  <td><b data-i18n-skip>{p.name}</b></td>
                  <td className={styles.r}>{vnd(p.revenue)}</td>
                  <td className={`${styles.r} ${styles.muted}`}>{vnd(p.cost)}</td>
                  <td className={`${styles.r} ${styles.muted}`}>{vnd(p.fee)}</td>
                  <td className={`${styles.r} ${styles.muted}`}>{vnd(p.adCost)}</td>
                  <td className={styles.r}>{pct((p.cost + p.fee + p.adCost) / p.revenue, 0)}</td>
                </tr>
              ))}
              {products.length === 0 && <tr><td colSpan={6} className={styles.muted} style={{ textAlign: "center", padding: 28 }}>Chưa có sản phẩm nào đủ dữ liệu giá vốn.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
