"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { useDialog } from "@/components/ui/DialogProvider";
import { AUTO_SYNC_MINUTES } from "@/lib/google/constants";
import { vnDateTime } from "@/lib/format/vn-time";
import { isUploadId } from "@/lib/orders/canonical";
import { createClient } from "@/lib/supabase/client";
import { ImportOrders } from "../dashboards/ImportOrders";
import { SourcePreview } from "../dashboards/SourcePreview";
import type { OrderSheetRow, SourceRow } from "./types";
import s from "./sources.module.css";

const nf = new Intl.NumberFormat("vi-VN");
const COLS = 7;

type Status = "ok" | "error" | "warn" | "pending";
const STATUS_TEXT: Record<Status, string> = { ok: "Đang hoạt động", error: "Lỗi đồng bộ", warn: "Có cảnh báo", pending: "Chưa đồng bộ" };

function StatusCell({ status }: { status: Status }) {
  return <span className={`${s.status} ${s[`st_${status}`]}`}><i aria-hidden />{STATUS_TEXT[status]}</span>;
}

/** Ghi chú ngay dưới dòng: kết quả thao tác vừa làm hoặc lỗi gần nhất. */
function NoteRow({ text, tone }: { text: string; tone: "error" | "info" }) {
  return (
    <tr className={s.noteRow}>
      <td colSpan={COLS}><span className={tone === "error" ? s.noteErr : s.noteInfo} data-i18n-skip>{text}</span></td>
    </tr>
  );
}

function SourceLine({ source }: { source: SourceRow }) {
  const dialog = useDialog();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);
  const upload = isUploadId(source.spreadsheet_id);
  const title = source.name ?? source.sheet_name;
  const status: Status = source.last_error ? "error" : source.last_synced_at ? "ok" : "pending";

  async function sync() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/sources/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: source.id }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(json.error ?? "Đồng bộ lỗi.");
    setMsg(json.changed === false ? "Dữ liệu trên Google Sheets không thay đổi." : `Đã cập nhật ${json.rowCount} dòng mới nhất.`);
    router.refresh();
  }

  // Xóa nguồn: bản sao dòng dữ liệu xóa theo (cascade ở DB). File gốc của bạn không bị đụng tới.
  async function remove() {
    const supabase = createClient();
    const { count } = await supabase.from("dashboards").select("id", { count: "exact", head: true }).contains("doc", { sources: [{ id: source.id }] });
    const used = count ?? 0;
    const warn = used > 0 ? `Nguồn này đang được ${used} dashboard sử dụng; các biểu đồ dùng nó sẽ không còn dữ liệu.\n\n` : "";
    const ok = await dialog.confirm({
      title: "Xóa nguồn dữ liệu?",
      message: upload
        ? `${warn}Xóa nguồn "${title}" và toàn bộ dữ liệu đơn hàng đã tải lên?\nFile gốc trên máy bạn không bị ảnh hưởng.`
        : `${warn}Xóa nguồn "${title}" và bản sao dữ liệu đã lưu?\nFile Google Sheets gốc của bạn không bị ảnh hưởng.`,
      confirmText: "Xóa nguồn",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    const { error } = await supabase.from("data_sources").delete().eq("id", source.id);
    setBusy(false);
    if (error) return setMsg(`Không xóa được: ${error.message}`);
    router.refresh();
  }

  return (
    <Fragment>
      <tr className={s.row}>
        <td><div className={s.name} data-i18n-skip>{title}</div><div className={s.sub}>{upload ? "Đơn hàng đa kênh (các sàn gộp một bảng)" : `Tab: ${source.sheet_name}`}</div></td>
        <td><span className={s.type}>{upload ? "File tải lên" : "Google Sheet"}</span></td>
        <td className={s.num}>{nf.format(source.row_count)}<div className={s.sub}>{`${source.columns.length} cột`}</div></td>
        <td className={s.when}>{vnDateTime(source.last_synced_at)}</td>
        <td>{upload ? "Tải file thủ công" : `Tự động mỗi ${AUTO_SYNC_MINUTES / 60} giờ`}</td>
        <td><StatusCell status={status} /></td>
        <td className={s.actions}>
          <button className={s.btn} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Ẩn dữ liệu" : "Xem dữ liệu"}</button>
          {upload ? (
            <ImportOrders label="Tải thêm file" />
          ) : (
            <button className={s.btn} onClick={sync} disabled={busy}>{busy ? <><Spinner size={12} inline />Đang xử lý…</> : "Cập nhật"}</button>
          )}
          <button className={`${s.btn} ${s.btnDanger}`} onClick={remove} disabled={busy}>Xóa</button>
        </td>
      </tr>
      {(msg || source.last_error) && <NoteRow text={msg || source.last_error || ""} tone={msg ? "info" : "error"} />}
      {open && (
        <tr className={s.previewRow}>
          <td colSpan={COLS}><SourcePreview sourceId={source.id} columns={source.columns} total={source.row_count} version={source.last_synced_at} /></td>
        </tr>
      )}
    </Fragment>
  );
}

function OrderSheetLine({ sheet }: { sheet: OrderSheetRow }) {
  const dialog = useDialog();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const warnings = (sheet.warnings ?? []).slice(0, 3);
  const status: Status = sheet.last_error ? "error" : !sheet.last_synced_at ? "pending" : warnings.length ? "warn" : "ok";

  async function sync() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/orders/sheets/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: sheet.id }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(json.error ?? "Đồng bộ lỗi.");
      else setMsg(json.changed === false ? "Dữ liệu trong Sheet không thay đổi." : `Đã cập nhật ${Number(json.lines).toLocaleString("vi-VN")} dòng (${Number(json.orders).toLocaleString("vi-VN")} đơn).`);
    } catch {
      setMsg("Lỗi mạng, thử lại sau.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function disconnect() {
    const ok = await dialog.confirm({
      title: "Ngắt kết nối Sheet?",
      message: `Ngắt kết nối "${sheet.name}"?\nDữ liệu kênh ${sheet.channel} đã nhập vẫn giữ nguyên nhưng không còn tự cập nhật. Sau đó bạn có thể tải file đơn hàng cho kênh này. Google Sheet gốc không bị ảnh hưởng.`,
      confirmText: "Ngắt kết nối",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/orders/sheets?id=${encodeURIComponent(sheet.id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(json.error ?? "Không ngắt kết nối được.");
    } catch {
      setMsg("Lỗi mạng, thử lại sau.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <Fragment>
      <tr className={s.row}>
        <td><div className={s.name} data-i18n-skip>{sheet.name}</div><div className={s.sub}>{`Kênh ${sheet.channel} · tab: ${sheet.sheet_name}`}</div></td>
        <td><span className={s.type}>Sheet đơn hàng</span></td>
        <td className={s.num}>{nf.format(sheet.line_count)}<div className={s.sub}>{`${nf.format(sheet.order_count)} đơn`}</div></td>
        <td className={s.when}>{vnDateTime(sheet.last_synced_at)}</td>
        <td>{`Tự động mỗi ${AUTO_SYNC_MINUTES / 60} giờ`}</td>
        <td><StatusCell status={status} /></td>
        <td className={s.actions}>
          <button className={s.btn} onClick={sync} disabled={busy}>{busy ? <><Spinner size={12} inline />Đang xử lý…</> : "Cập nhật"}</button>
          <button className={`${s.btn} ${s.btnDanger}`} onClick={disconnect} disabled={busy}>Ngắt kết nối</button>
        </td>
      </tr>
      {(msg || sheet.last_error) && <NoteRow text={msg || sheet.last_error || ""} tone={msg ? "info" : "error"} />}
      {!msg && !sheet.last_error && warnings.length > 0 && <NoteRow text={warnings.join(" · ")} tone="info" />}
    </Fragment>
  );
}

/** Bảng các nguồn dữ liệu: loại, quy mô, lần cập nhật, chế độ, trạng thái và thao tác. */
export function SourcesTable({ sources, orderSheets }: { sources: SourceRow[]; orderSheets: OrderSheetRow[] }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Nguồn</th>
            <th>Loại</th>
            <th className={s.numHead}>Số dòng</th>
            <th>Cập nhật lần cuối</th>
            <th>Chế độ cập nhật</th>
            <th>Trạng thái</th>
            <th className={s.actionsHead}>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {orderSheets.length === 0 && sources.length === 0 ? (
            <tr><td colSpan={COLS} className={s.emptyCell}><b>Chưa có nguồn dữ liệu nào</b><span>Chọn một cách kết nối ở phần &quot;Thêm nguồn mới&quot; bên dưới để bắt đầu.</span></td></tr>
          ) : (
            <>
              {orderSheets.map((x) => <OrderSheetLine key={x.id} sheet={x} />)}
              {sources.map((x) => <SourceLine key={x.id} source={x} />)}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
