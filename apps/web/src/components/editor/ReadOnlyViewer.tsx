"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Dashboard } from "@dashboard/schema";
import { Spinner } from "@/components/Spinner";
import { resetCalcSync, syncCalc } from "@/lib/editor/calc";
import { LOCAL_ROW_LIMIT, useData } from "@/lib/editor/data-store";
import { SAMPLE_SOURCE } from "@/lib/editor/sample-data";
import { useEditor } from "@/lib/editor/store";
import { site } from "@/lib/site";
import { Canvas } from "./Canvas";
import { PageNav, PageStage, PageSwitcher } from "./PageNav";
import { ViewFilters } from "./ViewFilters";
import { CommentsPanel } from "./CommentsPanel";
import cm from "./comments.module.css";
import { Brand } from "@/components/Brand";
import s from "./editor.module.css";

/**
 * Trình xem chỉ-đọc dùng cho: nhúng iframe (/embed/<mã>), link xem công khai (/view/<mã>) và người được mời quyền
 * Xem (/d/<id>). Người xem đổi được bộ lọc, bấm chart để lọc chéo, chuyển trang; KHÔNG có thanh công cụ sửa,
 * không lưu (không gọi autosave). `access` cho biết lấy dữ liệu bằng mã công khai hay bằng phiên đăng nhập.
 */
export type RowsAccess =
  /** Người xem công khai: lấy dữ liệu bằng mã chia sẻ trong URL. */
  | { kind: "token"; token: string }
  /** Người đã đăng nhập (được mời): lấy dữ liệu bằng phiên đăng nhập (RLS quyết định được đọc nguồn nào). */
  | { kind: "session" };

const rowsUrl = (a: RowsAccess, sourceId: string) =>
  a.kind === "token"
    ? `/api/embed/${encodeURIComponent(a.token)}/rows?source=${encodeURIComponent(sourceId)}`
    : `/api/sources/${encodeURIComponent(sourceId)}/rows`;

export function ReadOnlyViewer({ doc, access, sourceRows, bar, brand = true, commentsFor }: {
  /** Id dashboard để bật bình luận (chỉ khi người xem đã đăng nhập). Bỏ trống = không có bình luận. */
  commentsFor?: string;
  doc: Dashboard;
  /** Số dòng của từng nguồn (id → số dòng). Nguồn lớn không tải về: server gộp số liệu cho từng widget. */
  sourceRows: Record<string, number>;
  /** Cách lấy dữ liệu. Phải là dữ liệu thuần (không phải hàm) vì được truyền từ server component. */
  access: RowsAccess;
  /** Thanh tiêu đề phía trên (tên dashboard, nút chỉnh sửa...), tuỳ chọn. */
  bar?: ReactNode;
  /** Hiện dòng nhỏ "Tạo bằng Cerno" ở góc dưới. */
  brand?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);

  useEffect(() => {
    document.title = `${doc.name.trim() || "Dashboard"} | ${site.name}`;
    const loaded: Dashboard = {
      ...doc,
      sources: doc.sources.map((src) => (src.type === "sample" ? SAMPLE_SOURCE : src)),
    };
    const st = useEditor.getState();
    st.loadDoc(loaded);
    resetCalcSync();
    syncCalc(loaded);
    st.setMode("preview");
    setReady(true);

    let cancelled = false;
    const data = useData.getState();
    // Truy vấn số liệu của nguồn lớn đi qua đường dẫn tương ứng với cách truy cập (mã công khai hay phiên đăng nhập).
    data.setQueryBase(access.kind === "token" ? `/api/embed/${encodeURIComponent(access.token)}/query` : "/api/query");
    const sheets = loaded.sources.filter((x) => x.type === "google_sheets");
    void Promise.all(
      sheets.map(async (src) => {
        const count = sourceRows[src.id] ?? 0;
        data.setMeta(src.id, count);
        if (count > LOCAL_ROW_LIMIT) {
          data.setStatus(src.id, "ready");
          data.bumpEpoch(src.id);
          return;
        }
        data.setStatus(src.id, "loading");
        try {
          const res = await fetch(rowsUrl(access, src.id));
          if (!res.ok) throw new Error(String(res.status));
          const json = (await res.json()) as { rows: Parameters<typeof data.setRows>[1]; syncedAt?: string | null };
          if (!cancelled) useData.getState().setRows(src.id, json.rows, json.syncedAt ?? null);
        } catch {
          if (!cancelled) {
            useData.getState().setStatus(src.id, "error");
            setFailed(true);
          }
        }
      }),
    ).then(() => {
      if (!cancelled) setLoading(false);
    });

    // Luôn vừa khung iframe (người nhúng có thể đổi kích thước, hoặc xoay điện thoại).
    const refit = () => requestAnimationFrame(() => useEditor.getState().fit(0));
    refit();
    const unsub = useEditor.subscribe((cur, prev) => {
      if (cur.viewport.w !== prev.viewport.w || cur.viewport.h !== prev.viewport.h) refit();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [doc, access.kind, access.kind === "token" ? access.token : ""]);

  if (!ready) return <div className={s.loading}><Spinner size={36} label="Đang tải dashboard…" /></div>;

  return (
    <div className={s.viewRoot}>
      {bar}
      <div translate="no" className={`${s.app} ${s.appPreview} ${s.appFullscreen} ${s.appFill}`}>
      <div className={s.body}>
        <main className={s.center}>
          <PageNav />
          <div className={s.stage}>
            <PageStage>
              <Canvas />
            </PageStage>
            <ViewFilters />
            <PageSwitcher />
            {loading && (
              <div className={s.embedLoading}><Spinner size={28} label="Đang tải dữ liệu…" /></div>
            )}
            {failed && !loading && (
              <p className={s.embedError} role="alert">Không tải được một phần dữ liệu. Hãy tải lại trang.</p>
            )}
            {commentsFor && (
              <>
                <button className={cm.fab} onClick={() => setCommentsOpen((o) => !o)} aria-expanded={commentsOpen}>
                  💬 Bình luận
                </button>
                {commentsOpen && (
                  <aside className={cm.drawer} aria-label="Bình luận">
                    <div className={cm.drawerHead}>
                      Bình luận
                      <button onClick={() => setCommentsOpen(false)} aria-label="Đóng bình luận">×</button>
                    </div>
                    <div className={cm.drawerBody}><CommentsPanel dashboardId={commentsFor} /></div>
                  </aside>
                )}
              </>
            )}
            {brand && <a className={s.embedBrand} href="/" target="_blank" rel="noopener">Tạo bằng <Brand size={14} gap={5} tone="inherit" /></a>}
          </div>
        </main>
      </div>
      </div>
    </div>
  );
}
