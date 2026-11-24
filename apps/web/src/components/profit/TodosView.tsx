"use client";

import Link from "next/link";
import { useState } from "react";
import type { Todo } from "@/lib/profit/todos";
import { splitTodos, useDoneTodos, writeDoneTodos } from "@/lib/profit/todos-done";
import { compact, count, pct, vnd } from "./format";
import { ErrorBox, Loading, NoOrders } from "./Shared";
import { useProfitSummary } from "./useProfit";
import styles from "./profit.module.css";

export function todoText(t: Todo): { title: string; detail: string; impact: string; action: string } {
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
  const { data, error, loading, reload } = useProfitSummary({ ignorePeriod: true });
  const done = useDoneTodos();
  const [showDone, setShowDone] = useState(false);
  const toggle = (id: string) => writeDoneTodos(done.includes(id) ? done.filter((x) => x !== id) : [...done, id]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} retry={reload} />;
  if (!data) return null;
  if (!data.source) return <NoOrders />;
  const todos = data.todos ?? [];
  if (todos.length === 0) return <div className={styles.empty}><b style={{ color: "var(--text)" }}>Chưa có việc gì cần làm</b><span>Không có sản phẩm lỗ, đơn thiếu giá vốn hay đơn hoàn đáng kể.</span></div>;

  const { open, closed } = splitTodos(todos, done);
  const row = (t: Todo, isDone: boolean) => {
    const x = todoText(t);
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
          <Link href={t.href} className={`${styles.btn} ${t.priority !== "medium" && !isDone ? styles.primary : ""}`}>{x.action}</Link>
          <button className={styles.btn} onClick={() => toggle(t.id)}>{isDone ? "Bỏ đánh dấu" : "Đã xong"}</button>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.stack}>
      {open.length === 0 ? (
        <div className={styles.empty}><b style={{ color: "var(--text)" }}>Bạn đã xong hết các việc được gợi ý</b><span>Việc mới sẽ hiện ở đây khi số liệu có thay đổi.</span></div>
      ) : (
        open.map((t) => row(t, false))
      )}
      {closed.length > 0 && (
        <>
          <button type="button" className={styles.btn} style={{ alignSelf: "flex-start" }} onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
            {showDone ? `Ẩn ${closed.length} việc đã xong` : `Xem ${closed.length} việc đã xong`}
          </button>
          {showDone && closed.map((t) => row(t, true))}
        </>
      )}
      <p className={styles.small}>Gợi ý được tính từ số liệu đơn hàng, chỉ tính những sản phẩm có từ 3 đơn trở lên. &quot;Đã xong&quot; chỉ lưu trong trình duyệt này; nếu vấn đề vẫn còn trong số liệu, bạn có thể bỏ đánh dấu để xem lại.</p>
    </div>
  );
}
