"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/Spinner";
import type { ColumnMapping } from "@/lib/orders/canonical";
import { listSheetTabs, pickSpreadsheet, type PickedSheet } from "@/lib/google/picker-client";
import { OrderPreview, type PreviewInfo } from "./OrderPreview";
import dash from "./dashboards.module.css";
import tpl from "./templates.module.css";
import styles from "./import-orders.module.css";

interface Inspect extends PreviewInfo {
  sheetName: string;
  profile: "shopee" | "tiktok" | "generic";
  profileLabel: string;
}

interface Connected {
  lines: number;
  orders: number;
  warnings: string[];
}

const nf = new Intl.NumberFormat("vi-VN");

/**
 * Nối một tab Google Sheet làm nguồn đơn hàng của MỘT kênh. Luồng: chọn Sheet (Google Picker) → chọn tab → máy chủ đọc tab, nhận diện
 * cột và xem trước (chưa lưu gì) → người dùng kiểm tra/sửa → Nối và đồng bộ. Từ đó Cerno tự đọc lại Sheet mỗi 2 giờ (hoặc bấm Cập nhật).
 */
export function ConnectOrderSheet({ apiKey, appId, label = "+ Nối Google Sheet đơn hàng", onDone }: { apiKey: string; appId: string; label?: string; onDone?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedSheet | null>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [tab, setTab] = useState("");
  const [info, setInfo] = useState<Inspect | null>(null);
  const [working, setWorking] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Connected | null>(null);
  const seq = useRef(0);
  const notConfigured = !apiKey || !appId;

  const reset = () => {
    seq.current++;
    setPicked(null);
    setTabs([]);
    setTab("");
    setInfo(null);
    setWorking("");
    setError("");
  };

  const close = () => {
    if (saving) return;
    setOpen(false);
    reset();
    if (done) {
      router.refresh();
      onDone?.();
    }
    setDone(null);
  };

  useEffect(() => {
    if (!open) return;
    // Pha bắt + stopPropagation: khi hộp thoại này nằm trong hộp thoại chọn mẫu thì Esc chỉ đóng lớp trên cùng.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const inspect = useCallback(async (file: PickedSheet, sheetName: string, opts: { channel?: string | null; mapping?: ColumnMapping } = {}) => {
    const mine = ++seq.current;
    setWorking("Đang đọc Sheet…");
    setError("");
    try {
      const res = await fetch("/api/orders/sheets/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spreadsheetId: file.id, sheetName, channel: opts.channel ?? undefined, mapping: opts.mapping }),
      });
      const json = await res.json().catch(() => ({}));
      if (mine !== seq.current) return;
      if (!res.ok) {
        setInfo(null);
        setError(json.error ?? "Không đọc được Sheet.");
      } else setInfo(json as Inspect);
    } catch {
      if (mine === seq.current) setError("Lỗi mạng, thử lại sau.");
    } finally {
      if (mine === seq.current) setWorking("");
    }
  }, []);

  const choose = async () => {
    reset();
    setWorking("Đang mở Google…");
    try {
      const file = await pickSpreadsheet(apiKey, appId);
      if (!file) return setWorking("");
      setPicked(file);
      setWorking("Đang lấy danh sách tab…");
      const list = await listSheetTabs(file.id);
      setTabs(list);
      setTab(list[0] ?? "");
      if (list.length === 1) void inspect(file, list[0]);
      else setWorking("");
    } catch (e) {
      setWorking("");
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  };

  /** Đổi kênh/ánh xạ: xem trước lại với lựa chọn mới. */
  const change = (patch: { channel?: string | null; mapping?: ColumnMapping }) => {
    if (!picked || !info) return;
    void inspect(picked, info.sheetName, { channel: patch.channel === undefined ? info.channel : patch.channel, mapping: patch.mapping ?? info.mapping });
  };

  const save = async () => {
    if (!picked || !info || info.problems.length || !info.channel) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/orders/sheets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spreadsheetId: picked.id, sheetName: info.sheetName, name: `${picked.name} › ${info.sheetName}`, channel: info.channel, mapping: info.mapping }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Không nối được Sheet.");
      else setDone(json as Connected);
    } catch {
      setError("Lỗi mạng, thử lại sau.");
    } finally {
      setSaving(false);
    }
  };

  const busy = working !== "";
  return (
    <>
      <button className={dash.ghost} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className={tpl.backdrop} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className={tpl.dialog} role="dialog" aria-modal="true" aria-labelledby="cos-title">
            {saving && (
              <div className={tpl.busy}>
                <Spinner size={32} label="Đang nối và đồng bộ…" />
              </div>
            )}
            <h2 id="cos-title" className={tpl.dialogTitle}>Nối Google Sheet đơn hàng</h2>

            {done ? (
              <>
                <p className={styles.done}>{`Đã nối Sheet và nhập ${nf.format(done.lines)} dòng (${nf.format(done.orders)} đơn). Từ giờ Cerno tự đọc lại Sheet mỗi 2 giờ; bạn cũng có thể bấm "Cập nhật ngay" ở trang Nguồn dữ liệu.`}</p>
                {done.warnings.length > 0 && <ul className={`${styles.list} ${styles.warn}`}>{done.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                <div className={tpl.actions}>
                  <button className={dash.primary} onClick={close}>Xong</button>
                </div>
              </>
            ) : (
              <>
                {!picked && (
                  <>
                    <p className={tpl.sub}>Dùng Google Sheet làm nơi lưu đơn hàng của một sàn. Mỗi sàn một tab; dòng tiêu đề là tên cột của file xuất từ sàn.</p>
                    <ul className={styles.list}>
                      <li>Muốn thêm dữ liệu mới: dán dữ liệu xuất của sàn xuống dưới số liệu cũ trong Sheet, rồi bấm Cập nhật.</li>
                      <li>Dán chồng khoảng ngày cũng không sao: dòng trùng (cùng mã đơn, sản phẩm, phân loại) được bỏ, giữ dòng nằm dưới.</li>
                      <li>Nên đặt cột Mã đơn ở dạng Văn bản thuần (Định dạng › Số › Văn bản thuần) để mã dài không bị đổi sang số khoa học.</li>
                    </ul>
                    <div className={tpl.actions} style={{ justifyContent: "flex-start" }}>
                      <button className={dash.primary} onClick={choose} disabled={busy || notConfigured}>Chọn Google Sheet</button>
                    </div>
                    {notConfigured && <p className={tpl.error}>Thiếu NEXT_PUBLIC_GOOGLE_API_KEY / NEXT_PUBLIC_GOOGLE_APP_ID.</p>}
                  </>
                )}

                {picked && (
                  <p className={styles.file}>
                    <b>{picked.name}</b>
                    {info && <span className={styles.badge}>{info.profile === "generic" ? info.profileLabel : `Nhận diện: ${info.profileLabel}`}</span>}
                  </p>
                )}
                {busy && <p className={styles.working}><Spinner size={14} inline />{working}</p>}

                {picked && tabs.length > 1 && !info && !busy && (
                  <div className={tpl.slots}>
                    <div className={tpl.slotRow}>
                      <div className={tpl.slotLabel}>Tab chứa đơn hàng</div>
                      <select className={tpl.select} value={tab} aria-label="Tab" onChange={(e) => setTab(e.target.value)}>
                        {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className={tpl.actions}>
                      <button className={dash.primary} onClick={() => void inspect(picked, tab)} disabled={!tab}>Đọc tab này</button>
                    </div>
                  </div>
                )}

                {info && (
                  <OrderPreview info={info} busy={busy} mode="sheet" onChange={change}>
                    {tabs.length > 1 && (
                      <div className={tpl.slotRow}>
                        <div className={tpl.slotLabel}>Tab trong Sheet</div>
                        <select
                          className={tpl.select}
                          value={info.sheetName}
                          disabled={busy}
                          aria-label="Tab trong Sheet"
                          onChange={(e) => {
                            setTab(e.target.value);
                            void inspect(picked as PickedSheet, e.target.value);
                          }}
                        >
                          {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    )}
                  </OrderPreview>
                )}
                {info && info.channel && (
                  <p className={tpl.note}>{`Dữ liệu kênh ${info.channel} hiện có trong "Đơn hàng đa kênh" (nếu có, kể cả đã tải bằng file) sẽ được thay bằng dữ liệu từ Sheet này. Sau đó kênh ${info.channel} chỉ nhận dữ liệu từ Sheet.`}</p>
                )}

                {error && <p className={tpl.error} role="alert">{error}</p>}

                <div className={tpl.actions}>
                  {picked && <button className={dash.ghost} onClick={reset} disabled={saving}>Chọn Sheet khác</button>}
                  <button className={dash.ghost} onClick={close} disabled={saving}>Hủy</button>
                  <button className={dash.primary} onClick={save} disabled={!info || busy || saving || info.problems.length > 0}>Nối và đồng bộ</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
