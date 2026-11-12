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
import { SectionHead, sectionClass } from "./SectionHead";
import { useDialog } from "@/components/ui/DialogProvider";

import { createBlankDashboard, createDemoDashboard } from "@/lib/editor/defaults";
import { clearDraft, loadDraft } from "@/lib/editor/io";
import { Spinner } from "@/components/Spinner";
import { TEMPLATES, type TemplateEntry } from "@/content/templates";
import type { TemplateSource } from "@/lib/templates/source";
import { TemplateGallery } from "./TemplateGallery";
import { TemplateMapDialog } from "./TemplateMapDialog";
import styles from "./dashboards.module.css";

interface Props {
  dashboards: DashboardRow[];
  sources: TemplateSource[];
  apiKey: string;
  appId: string;
}

export function DashboardList({ dashboards, sources, apiKey, appId }: Props) {
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
    <section className={sectionClass("dash")}>
      {(busy || opening) && (
        <div className={styles.overlay}>
          <Spinner size={36} label={opening ? "Đang mở dashboard…" : "Đang xử lý…"} />
        </div>
      )}
      <SectionHead
        kind="dash"
        title="Dashboard của bạn"
        count={dashboards.length}
        desc="Các trang báo cáo bạn thiết kế. Mọi thay đổi trong editor tự lưu lên tài khoản, mở lại ở trình duyệt nào cũng thấy."
        actions={
          <>
            <button className={styles.ghost} disabled={busy} onClick={() => setShowGallery((v) => !v)}>Từ mẫu theo ngành</button>
            <button className={styles.ghost} disabled={busy} onClick={() => create("demo")}>Từ dashboard mẫu</button>
            <button className={styles.primary} disabled={busy} onClick={() => create("blank")}>+ Dashboard trống</button>
          </>
        }
      />

      {hasDraft && (
        <p className={styles.notice}>
          Trình duyệt này còn một bản nháp chưa lên tài khoản.{" "}
          <button className={styles.linkBtn} disabled={busy} onClick={importDraft}>Chuyển bản nháp lên tài khoản</button>
        </p>
      )}
      {msg && <p className={styles.warn} role="alert">{msg}</p>}

      {(showGallery || dashboards.length === 0) && <TemplateGallery entries={TEMPLATES} onPick={setPicked} />}

      {picked && (
        <TemplateMapDialog entry={picked} sources={sources} apiKey={apiKey} appId={appId} onClose={() => setPicked(null)} />
      )}

      {dashboards.length === 0 ? (
        <p className={styles.empty}>Chưa có dashboard nào. Chọn một mẫu ở trên hoặc tạo dashboard trống để bắt đầu.</p>
      ) : (
        <ul className={styles.list}>
          {dashboards.map((d) => (
            <li key={d.id} className={styles.item}>
              <div className={styles.itemTop}>
                <div>
                  <Link href={`/editor/${d.id}`} className={styles.dashName}>{d.name}</Link>
                  <div className={styles.muted}>Sửa lần cuối: {new Date(d.updated_at).toLocaleString("vi-VN")}</div>
                </div>
                <div className={styles.row}>
                  <Link href={`/editor/${d.id}`} className={styles.ghost}>Mở</Link>
                  <button className={styles.ghost} disabled={busy} onClick={() => rename(d)}>Đổi tên</button>
                  <button className={styles.ghost} disabled={busy} onClick={() => remove(d)}>Xoá</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
