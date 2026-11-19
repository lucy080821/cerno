"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Todo } from "@/lib/profit/todos";
import { compact, count, pct, vnd } from "./format";
import { ErrorBox, Loading, NoOrders } from "./Shared";
import { useProfitSummary } from "./useProfit";
import styles from "./profit.module.css";

const DONE_KEY = "cerno.profit.todos.done";

function readDone(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(DONE_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function text(t: Todo): { title: string; detail: string; impact: string; action: string } {
  switch (t.kind) {
    case "missing_cost":
      return { title: `Nhập giá vốn cho ${count(t.amount ?? 0)} sản phẩm`, detail: `${count(t.orders ?? 0)} đơn chưa tính được lãi vì thiếu giá vốn. Nhập một lần, Cerno tính lại mọi đơn.`, impact: "Mở khóa số liệu lãi", action: "Nhập giá vốn" };
    case "loss_product":
      return {
        title: `${t.product} đang lỗ ${vnd(-(t.amount ?? 0) / Math.max(1, t.orders ?? 1))} mỗi đơn`,
        detail: `Giá bán trung bình ${vnd(t.avgPrice)}, giá hòa vốn ${vnd(t.breakEvenPrice)}. Tăng giá hoặc giảm voucher, quảng cáo cho sản phẩm này.`,
        impact: `Đang mất ${compact(-(t.amount ?? 0))}`,
        action: "Xem sản phẩm",
      };
    case "ads_product":
      return {
        title: `Giảm quảng cáo cho ${t.product}`,
        detail: `Quảng cáo ${vnd(t.adPerOrder)} mỗi đơn, bằng ${pct(t.adPerOrder && t.grossPerOrder ? t.adPerOrder / t.grossPerOrder : null, 0)} lãi trước quảng cáo (${vnd(t.grossPerOrder)} mỗi đơn).`,
        impact: `Quảng cáo ${compact(-(t.amount ?? 0))}`,
        action: "Xem lãi lỗ",
      };
    case "returns":
      return { title: `Xem ${count(t.orders ?? 0)} đơn hoàn và hủy`, detail: "Giữ bằng chứng để khiếu nại đơn hoàn, tắt quảng cáo sớm cho đơn chưa chốt.", impact: `Đang mất ${compact(-(t.amount ?? 0))}`, action: "Xem đơn" };
    case "thin":
      return { title: `${count(t.orders ?? 0)} đơn lãi dưới 5%`, detail: "Bán thêm những đơn này gần như không có lãi. Xem lại giá bán, voucher và quảng cáo.", impact: "", action: "Xem đơn" };
  }
}

const PRI: Record<Todo["priority"], { label: string; cls: string }> = {
  data: { label: "Dữ liệu", cls: "bWarn" },
  high: { label: "Ưu tiên", cls: "bNeg" },
  medium: { label: "Nên làm", cls: "" },
};

/** Trang Việc cần làm: gợi ý suy ra từ số liệu lãi từng đơn (không dùng AI). Đánh dấu "đã xong" lưu trong trình duyệt. */
export function TodosView() {
  const { data, error, loading, reload } = useProfitSummary();
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => setDone(readDone()), []);
  const toggle = (id: string) =>
    setDone((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      try {
        window.localStorage.setItem(DONE_KEY, JSON.stringify(next));
      } catch {
        /* chế độ riêng tư: chỉ nhớ trong phiên */
      }
      return next;
    });

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} retry={reload} />;
  if (!data) return null;
  if (!data.source) return <NoOrders />;
  const todos = data.todos ?? [];
  if (todos.length === 0) return <div className={styles.empty}><b style={{ color: "var(--text)" }}>Chưa có việc gì cần làm</b><span>Không có sản phẩm lỗ, đơn thiếu giá vốn hay đơn hoàn đáng kể.</span></div>;

  return (
    <div className={styles.stack}>
      {todos.map((t) => {
        const x = text(t);
        const isDone = done.includes(t.id);
        const pri = PRI[t.priority];
        return (
          <div key={t.id} className={`${styles.task} ${isDone ? styles.taskDone : ""}`}>
            <span className={`${styles.badge} ${pri.cls ? styles[pri.cls] : ""}`}>{pri.label}</span>
            <div>
              <b>{x.title}</b>
              <div className={styles.small} style={{ marginTop: 3, lineHeight: 1.5 }}>{x.detail}</div>
              {x.impact && <div className={styles.small} style={{ marginTop: 3 }}><b>{x.impact}</b></div>}
            </div>
            <div className={styles.toolbar}>
              <Link href={t.href} className={`${styles.btn} ${t.priority !== "medium" ? styles.primary : ""}`}>{x.action}</Link>
              <button className={styles.btn} onClick={() => toggle(t.id)}>{isDone ? "Bỏ đánh dấu" : "Đã xong"}</button>
            </div>
          </div>
        );
      })}
      <p className={styles.small}>Gợi ý được tính từ số liệu đơn hàng, chỉ tính những sản phẩm có từ 3 đơn trở lên. &quot;Đã xong&quot; chỉ lưu trong trình duyệt này.</p>
    </div>
  );
}
