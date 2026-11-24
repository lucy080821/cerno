"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  createDashboard,
  deleteDashboard,
  renameDashboard,
  type DashboardRow,
} from "@/lib/dashboards/api";
import { useDialog } from "@/components/ui/DialogProvider";

import { createBlankDashboard, createDemoDashboard } from "@/lib/editor/defaults";
import { clearDraft, loadDraft } from "@/lib/editor/io";
import { Spinner } from "@/components/Spinner";
import { TEMPLATES, type TemplateEntry } from "@/content/templates";
import { vnDateTime } from "@/lib/format/vn-time";
import type { TemplateSource } from "@/lib/templates/source";
import { TemplateGallery } from "./TemplateGallery";
import { TemplateMapDialog } from "./TemplateMapDialog";
import styles from "./dashboards.module.css";
import s from "../sources/sources.module.css";

export interface SharedDashboard {
  id: string;
  name: string;
  updated_at: string;
  role: "viewer" | "editor";
}

interface Props {
  dashboards: DashboardRow[];
  shared: SharedDashboard[];
  sources: TemplateSource[];
  apiKey: string;
  appId: string;
}

/** Trang Dashboard: danh sách dashboard của bạn và dashboard được chia sẻ, dạng bảng quản trị cùng phong cách trang Nguồn dữ liệu. */
export function DashboardList({ dashboards, shared, sources, apiKey, appId }: Props) {
  const dialog = useDialog();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [hasDraft, setHasDraft] = useState(false);
  // Đã tạo xong, đang chuyển sang editor: giữ vòng quay đến khi trang mới hiện (busy đã tắt ở finally).
  const [opening, setOpening] = useState(false);
  // Thư viện mẫu: tự mở khi chưa có dashboard nào, còn lại mở bằng nút.
  const [showGallery, setShowGallery] = useState(false);
  const [picked, setPicked] = useState<TemplateEntry | null>(null);

  // Bản nháp cũ trong trình duyệt (từ lúc editor chỉ lưu cục bộ): đề nghị chuyển lên tài khoản.
  useEffect(() => setHasDraft(loadDraft() !== null), []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Có lỗi xảy ra.");
    } finally {
      setBusy(false);
    }
  };

  const create = (kind: "blank" | "demo") =>
    run(async () => {
      const id = await createDashboard(kind === "blank" ? createBlankDashboard() : createDemoDashboard());
      setOpening(true);
      router.push(`/editor/${id}`);
    });

  const importDraft = () =>
    run(async () => {
      const draft = loadDraft();
      if (!draft) return;
      const id = await createDashboard(draft);
      clearDraft();
      setOpening(true);
      router.push(`/editor/${id}`);
    });

  // Hỏi người dùng TRƯỚC khi vào run(): run() bật lớp phủ "Đang xử lý" che cả hộp thoại.
  const rename = async (d: DashboardRow) => {
    const name = await dialog.prompt({
      title: "Đổi tên dashboard",
      label: "Tên mới",
      defaultValue: d.name,
      maxLength: 120,
      confirmText: "Lưu tên",
      validate: (v) => (v.trim() ? null : "Tên không được để trống."),
    });
    if (name === null || name.trim() === d.name) return;
    await run(async () => {
      await renameDashboard(d.id, name);
      router.refresh();
    });
  };

  const remove = async (d: DashboardRow) => {
    const ok = await dialog.confirm({
      title: "Xóa dashboard?",
      message: `Xóa dashboard "${d.name}"? Thao tác này không khôi phục được.`,
      confirmText: "Xóa dashboard",
      tone: "danger",
    });
    if (!ok) return;
    await run(async () => {
      await deleteDashboard(d.id);
      router.refresh();
    });
  };

  return (
    <div className={s.page}>
      {(busy || opening) && (
        <div className={styles.overlay}>
          <Spinner size={36} label={opening ? "Đang mở dashboard…" : "Đang xử lý…"} />
        </div>
      )}

      <header className={s.head}>
        <div>
          <h2 className={s.title}>Dashboard</h2>
          <p className={s.lead}>Các trang báo cáo bạn thiết kế từ dữ liệu của mình. Mọi thay đổi trong editor tự lưu lên tài khoản, mở lại ở trình duyệt nào cũng thấy.</p>
        </div>
        <div className={s.headActions}>
          <button className={s.btn} disabled={busy} onClick={() => setShowGallery((v) => !v)}>Từ mẫu theo ngành</button>
          <button className={s.btn} disabled={busy} onClick={() => create("demo")}>Từ dashboard mẫu</button>
          <button className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={() => create("blank")}>+ Dashboard trống</button>
        </div>
      </header>

      {hasDraft && (
        <p className={s.noteInfo}>
          Trình duyệt này còn một bản nháp chưa lên tài khoản.{" "}
          <button className={styles.linkBtn} disabled={busy} onClick={importDraft}>Chuyển bản nháp lên tài khoản</button>
        </p>
      )}
      {msg && <p className={s.noteErr} role="alert">{msg}</p>}

      {(showGallery || dashboards.length === 0) && <TemplateGallery entries={TEMPLATES} onPick={setPicked} />}

      {picked && (
        <TemplateMapDialog entry={picked} sources={sources} apiKey={apiKey} appId={appId} onClose={() => setPicked(null)} />
      )}

      <section className={s.panel}>
        <div className={s.panelHead}>
          <h3>Dashboard của bạn</h3>
          <span className={s.panelNote}>{`${dashboards.length} mục`}</span>
        </div>
        <div className={s.tableWrap}>
          <table className={`${s.table} ${s.tableMid}`}>
            <thead>
              <tr>
                <th>Tên dashboard</th>
                <th>Sửa lần cuối</th>
                <th className={s.actionsHead}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {dashboards.length === 0 ? (
                <tr>
                  <td colSpan={3} className={s.emptyCell}>
                    <b>Chưa có dashboard nào</b>
                    <span>Chọn một mẫu ở trên hoặc tạo dashboard trống để bắt đầu.</span>
                  </td>
                </tr>
              ) : (
                dashboards.map((d) => (
                  <tr key={d.id} className={s.row}>
                    <td className={s.name}><Link href={`/editor/${d.id}`} className={s.link} data-i18n-skip>{d.name}</Link></td>
                    <td className={s.when}>{vnDateTime(d.updated_at)}</td>
                    <td className={s.actions}>
                      <Link href={`/editor/${d.id}`} className={s.btn}>Mở</Link>
                      <button className={s.btn} disabled={busy} onClick={() => rename(d)}>Đổi tên</button>
                      <button className={`${s.btn} ${s.btnDanger}`} disabled={busy} onClick={() => remove(d)}>Xoá</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {shared.length > 0 && (
        <section className={s.panel}>
          <div className={s.panelHead}>
            <h3>Được chia sẻ với bạn</h3>
            <span className={s.panelNote}>{`${shared.length} mục`}</span>
          </div>
          <div className={s.tableWrap}>
            <table className={`${s.table} ${s.tableMid}`}>
              <thead>
                <tr>
                  <th>Tên dashboard</th>
                  <th>Quyền của bạn</th>
                  <th>Sửa lần cuối</th>
                  <th className={s.actionsHead}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {shared.map((d) => {
                  const href = d.role === "editor" ? `/editor/${d.id}` : `/d/${d.id}`;
                  return (
                    <tr key={d.id} className={s.row}>
                      <td className={s.name}><Link href={href} className={s.link} data-i18n-skip>{d.name}</Link></td>
                      <td><span className={s.type}>{d.role === "editor" ? "Được sửa" : "Chỉ xem"}</span></td>
                      <td className={s.when}>{vnDateTime(d.updated_at)}</td>
                      <td className={s.actions}><Link href={href} className={s.btn}>Mở</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className={s.foot}>
        Nguồn dữ liệu quản lý ở <Link href="/sources">Nguồn dữ liệu</Link>, mẫu theo ngành ở <Link href="/templates">Mẫu dashboard</Link>.
        {" "}<Link href="/privacy">Quyền riêng tư</Link> · <Link href="/terms">Điều khoản</Link>
      </p>
    </div>
  );
}
