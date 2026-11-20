"use client";

import { useCallback, useEffect, useState } from "react";
import { useDialog } from "@/components/ui/DialogProvider";
import { ALL_CHANNELS, type AdChannelSummary } from "@/lib/profit/ad-spend";
import { dayText, nf, vnd } from "./format";
import { ImportAdSpend } from "./ImportAdSpend";
import { Card } from "./Shared";
import styles from "./profit.module.css";

interface AdInfo {
  available: boolean;
  editable: boolean;
  channels: AdChannelSummary[];
}

const channelName = (c: string) => (c === ALL_CHANNELS ? "Mọi kênh" : c);

/**
 * Chi phí quảng cáo theo ngày: tải file báo cáo quảng cáo (Shopee Ads, Facebook Ads...), Cerno chia cho các đơn hàng cùng ngày
 * và kênh theo doanh thu. Đây là chỗ nhập khi file đơn hàng không có cột chi phí quảng cáo.
 */
export function AdSpendCard({ editable, adCostInOrders, onChanged }: { editable: boolean; adCostInOrders: number; onChanged: () => void }) {
  const dialog = useDialog();
  const [info, setInfo] = useState<AdInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ads", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setInfo(json as AdInfo);
      else setError(json.error ?? "Không tải được chi phí quảng cáo.");
    } catch {
      setError("Lỗi mạng, thử lại sau.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const changed = () => {
    void load();
    onChanged();
  };

  const remove = async (c: AdChannelSummary) => {
    const ok = await dialog.confirm({
      title: "Xóa chi phí quảng cáo?",
      message: `Xóa chi phí quảng cáo ${c.channel === ALL_CHANNELS ? "chia cho mọi kênh" : `của kênh ${c.channel}`} (${nf.format(c.days)} ngày)? Chi phí quảng cáo của các đơn hàng trong những ngày đó sẽ về trống, lãi từng đơn được tính lại.`,
      confirmText: "Xóa",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/ads?channel=${encodeURIComponent(c.channel)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Không xóa được, thử lại sau.");
      else changed();
    } catch {
      setError("Lỗi mạng, thử lại sau.");
    } finally {
      setBusy(false);
    }
  };

  const total = info?.channels.reduce((n, c) => n + c.total, 0) ?? 0;

  return (
    <Card title="Chi phí quảng cáo" aside={info && info.channels.length > 0 ? `đã nhập ${vnd(total)}` : undefined}>
      {info && !info.available && (
        <div className={styles.warn}>Cần chạy migration 0019_ad_spend.sql trên Supabase trước khi nhập chi phí quảng cáo theo ngày.</div>
      )}
      {info && info.available && info.channels.length === 0 && (
        <p className={styles.small} style={{ marginTop: 0 }}>
          {adCostInOrders > 0
            ? "Chi phí quảng cáo hiện lấy từ cột trong file đơn hàng. Nếu bạn có file báo cáo quảng cáo theo ngày (Shopee Ads, Facebook Ads, TikTok Ads...), tải lên để Cerno chia theo ngày và kênh."
            : "Chưa có chi phí quảng cáo nên lãi từng đơn đang bị tính cao hơn thực tế. Tải file báo cáo quảng cáo theo ngày (Shopee Ads, Facebook Ads, TikTok Ads...): Cerno cộng theo ngày rồi chia cho các đơn hàng cùng ngày và kênh theo doanh thu."}
        </p>
      )}
      {info && info.channels.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Kênh</th><th className={styles.r}>Số ngày</th><th>Khoảng thời gian</th><th className={styles.r}>Tổng chi phí</th>{editable && <th />}</tr>
            </thead>
            <tbody>
              {info.channels.map((c) => (
                <tr key={c.channel}>
                  <td><b>{channelName(c.channel)}</b></td>
                  <td className={styles.r}>{nf.format(c.days)}</td>
                  <td>{`${dayText(c.from)} – ${dayText(c.to)}`}</td>
                  <td className={styles.r}>{vnd(c.total)}</td>
                  {editable && <td className={styles.r}><button className={styles.btn} disabled={busy} onClick={() => remove(c)}>Xóa</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className={styles.neg} role="alert">{error}</p>}
      {info?.available && editable && (
        <div style={{ marginTop: 12 }}>
          <ImportAdSpend label={info.channels.length ? "+ Tải thêm file chi phí quảng cáo" : "+ Tải file chi phí quảng cáo"} onDone={changed} />
        </div>
      )}
      <p className={styles.small} style={{ marginTop: 10 }}>Chi phí quảng cáo được chia cho đơn hàng cùng ngày và kênh theo doanh thu, nên là số ước tính, không phải số thật từng đơn.</p>
    </Card>
  );
}
