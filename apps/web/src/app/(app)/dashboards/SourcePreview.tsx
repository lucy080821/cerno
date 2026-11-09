"use client";

import { useEffect, useState } from "react";
import styles from "./dashboards.module.css";
import { Spinner } from "@/components/Spinner";

type Cell = string | number | boolean | null;
type Col = { name: string; type: string; unit?: string };

const PREVIEW_ROWS = 100;
const TYPE_LABEL: Record<string, string> = { string: "chữ", number: "số", date: "ngày", boolean: "đúng/sai" };

/** Số giây → h:mm:ss (cột thời lượng được lưu dưới dạng số giây). */
function duration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function show(v: Cell, col: Col): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Đúng" : "Sai";
  if (typeof v === "number") return col.unit === "giây" ? duration(v) : v.toLocaleString("vi-VN");
  return v;
}

/** Bảng xem trước các dòng đã đồng bộ của một nguồn (100 dòng đầu). `version` đổi (sau khi đồng bộ lại) thì tải lại. */
export function SourcePreview({ sourceId, columns, total, version }: {
  sourceId: string;
  columns: Col[];
  total: number;
  version: string | null;
}) {
  const [rows, setRows] = useState<Record<string, Cell>[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError("");
    fetch(`/api/sources/${sourceId}/rows?limit=${PREVIEW_ROWS}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Không tải được dữ liệu.");
        if (!cancelled) setRows(json.rows);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Không tải được dữ liệu."));
    return () => {
      cancelled = true;
    };
  }, [sourceId, version]);

  if (error) return <p className={styles.warn} role="alert">{error}</p>;
  if (!rows) return <p className={styles.muted}><Spinner size={12} inline />Đang tải dữ liệu…</p>;
  if (rows.length === 0) return <p className={styles.muted}>Nguồn này chưa có dòng dữ liệu nào.</p>;

  return (
    <div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.rowNo}>#</th>
              {columns.map((c) => (
                <th key={c.name} className={c.type === "number" ? styles.num : undefined}>
                  {c.name} <em className={styles.colType}>{TYPE_LABEL[c.type] ?? c.type}</em>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className={styles.rowNo}>{i + 1}</td>
                {columns.map((c) => (
                  <td key={c.name} className={c.type === "number" ? styles.num : undefined} title={String(r[c.name] ?? "")}>
                    {show(r[c.name] ?? null, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted}>
        Hiển thị {rows.length.toLocaleString("vi-VN")} / {total.toLocaleString("vi-VN")} dòng
        {rows.length < total ? " (xem trước)." : "."}
      </p>
    </div>
  );
}
