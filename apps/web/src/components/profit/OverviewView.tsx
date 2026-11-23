"use client";

import Link from "next/link";
import { DayBars } from "./charts";
import { compact, count, pct, vnd } from "./format";
import { Card, ErrorBox, FeeEstimateNote, ShipEstimateNote, Kpi, Loading, MissingCostNote } from "./Shared";
import { todoText } from "./TodosView";
import { useProfitSummary } from "./useProfit";
import styles from "./profit.module.css";

const LINKS = [
  { href: "/orders", title: "Đơn hàng", desc: "Lãi của từng đơn, đơn nào lỗ và vì sao." },
  { href: "/products", title: "Sản phẩm và giá vốn", desc: "Nhập giá vốn để tính đúng lãi mọi đơn." },
  { href: "/dashboards", title: "Dashboard", desc: "Tự thiết kế báo cáo từ dữ liệu của bạn." },
  { href: "/sources", title: "Nguồn dữ liệu", desc: "Tải file đơn hàng hoặc nối Google Sheets." },
];

/** Trang Tổng quan: vài con số chính, lãi theo ngày, 3 việc nên làm trước và lối tắt. */
export function OverviewView() {
  const { data, error, loading, reload } = useProfitSummary();
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} retry={reload} />;
  if (!data) return null;
  const s = data.summary;

  return (
    <div className={styles.stack}>
      {!data.source || !s || s.orders === 0 ? (
        <div className={styles.empty}>
          <b style={{ color: "var(--text)", fontSize: "1.05rem" }}>Bắt đầu bằng dữ liệu đơn hàng</b>
          <span>Tải file đơn hàng Excel/CSV từ Shopee, TikTok Shop hoặc sổ bán hàng. Cerno tính lãi thật của từng đơn sau phí sàn, giá vốn và quảng cáo.</span>
          <Link href="/sources" className={`${styles.btn} ${styles.primary}`}>Tải file đơn hàng</Link>
        </div>
      ) : (
        <>
          <MissingCostNote missing={s.missingCost} total={s.orders} />
          <FeeEstimateNote count={s.feeEstimated} />
      <ShipEstimateNote count={s.shipEstimated} />
          <div className={styles.kpis}>
            <Kpi label="Lãi thật" value={compact(s.profit)} tone={s.profit < 0 ? "neg" : "pos"} note={`Biên lãi ${pct(s.margin)}`} />
            <Kpi label="Doanh thu thực" value={compact(s.revenue)} note={s.dateMin && s.dateMax ? `${s.dateMin} → ${s.dateMax}` : undefined} />
            <Kpi label="Tổng số đơn" value={count(s.orders)} note={`${count(s.cancelled + s.returned)} đơn hoàn và hủy`} />
            <Kpi label="Đơn đang lỗ" value={count(s.loss)} tone={s.loss ? "neg" : undefined} note={`Mất ${compact(-s.lossAmount)}`} />
          </div>
          <div className={styles.grid2}>
            <Card title="Lãi mỗi ngày" aside={<Link href="/profit">Xem lãi lỗ</Link>}><DayBars data={s.daily} /></Card>
            <Card title="Việc nên làm trước" aside={<Link href="/todos">Xem tất cả</Link>}>
              {(data.todos ?? []).length === 0 ? (
                <p className={styles.small}>Chưa có việc gì cần làm.</p>
              ) : (
                (data.todos ?? []).slice(0, 3).map((t) => {
                  const x = todoText(t);
                  return (
                    <div key={t.id} className={styles.todoRow}>
                      <div>
                        <b>{x.title}</b>
                        {x.impact && <div className={styles.small}>{x.impact}</div>}
                      </div>
                      <Link href={t.href} className={styles.btn}>{x.action}</Link>
                    </div>
                  );
                })
              )}
            </Card>
          </div>
          <div className={styles.kpis}>
            <Kpi label="Lãi trung bình mỗi đơn" value={vnd(s.avgProfit)} />
            <Kpi label="Phí sàn" value={compact(s.fee)} note={`${pct(s.revenue ? s.fee / s.revenue : null)} doanh thu`} />
            <Kpi label="Giá vốn" value={compact(s.cost)} note={`${pct(s.revenue ? s.cost / s.revenue : null)} doanh thu`} />
            <Kpi label="Quảng cáo" value={compact(s.adCost)} note={`${pct(s.revenue ? s.adCost / s.revenue : null)} doanh thu`} />
          </div>
        </>
      )}
      <div className={styles.links}>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={styles.linkCard}><b>{l.title}</b><span>{l.desc}</span></Link>
        ))}
      </div>
    </div>
  );
}
