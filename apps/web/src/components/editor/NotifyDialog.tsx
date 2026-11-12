"use client";

import { useCallback, useEffect, useState } from "react";
import { enableLink } from "@/lib/embed/api";
import {
  createReport, deleteReport, listReports, previewReport, sendTestReport, updateReport,
  type PreviewResult, type ReportList, type ReportRow,
} from "@/lib/notify/api";
import {
  FREQUENCY_LABELS, MAX_PROMPT, MAX_WIDGETS, PROMPT_SUGGESTIONS, WEEKDAY_LABELS, appendSuggestion, emptyForm, formFromRow, formToInput,
  hourLabel, scheduleParts, type ReportForm, type ReportableWidget,
} from "@/lib/notify/format";
import { Spinner } from "@/components/Spinner";
import { useDialog } from "@/components/ui/DialogProvider";
import { Icon } from "./fields";
import s from "./editor.module.css";
import n from "./notify.module.css";

type Msg = { kind: "ok" | "err"; text: string } | null;

/** dd/mm/yyyy HH:mm theo giờ Việt Nam. */
function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MONTH_DAYS = Array.from({ length: 31 }, (_, d) => d + 1);

// ---------------------------------------------------------------------------------------------

function ReportsTab({ dashboardId, widgets }: { dashboardId: string; widgets: ReportableWidget[] }) {
  const dialog = useDialog();
  const [data, setData] = useState<ReportList | null>(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<ReportForm | null>(null);
  const [busy, setBusy] = useState<"save" | "preview" | "test" | "row" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await listReports(dashboardId));
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Không tải được danh sách báo cáo.");
    }
  }, [dashboardId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Có lỗi xảy ra." });
    } finally {
      setBusy(null);
    }
  };

  const openNew = () => {
    if (!data) return;
    setPreview(null);
    setMsg(null);
    setForm(emptyForm(data.me));
  };
  const openEdit = (r: ReportRow) => {
    setPreview(null);
    setMsg(null);
    setForm(formFromRow(r));
  };
  const patch = (p: Partial<ReportForm>) => setForm((f) => (f ? { ...f, ...p } : f));

  /**
   * Báo cáo dùng link xem công khai cần chủ dashboard bật link đó. Hỏi TRƯỚC khi vào trạng thái bận (hộp thoại không bị lớp phủ che).
   * Trả false nếu người dùng từ chối hoặc không thể bật (khi đó không lưu).
   */
  const ensureViewLink = async (f: ReportForm): Promise<boolean> => {
    if (!data || f.link_mode !== "view_link" || data.viewLinkEnabled) return true;
    if (!data.isOwner) {
      setMsg({ kind: "err", text: "Chủ dashboard chưa bật link xem. Hãy chọn “Link đăng nhập” hoặc nhờ chủ dashboard bật link xem." });
      return false;
    }
    const ok = await dialog.confirm({
      title: "Bật link xem công khai?",
      message: "Báo cáo dùng link xem để người nhận mở dashboard mà không cần đăng nhập. Ai có link đều xem được dashboard (không sửa được). Bật link xem cho dashboard này?",
      confirmText: "Bật link xem",
    });
    if (!ok) return false;
    try {
      await enableLink(dashboardId);
      setData((d) => (d ? { ...d, viewLinkEnabled: true } : d));
      return true;
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Không bật được link xem." });
      return false;
    }
  };

  const validate = (f: ReportForm): string | null => (/^\S+@\S+\.\S+$/.test(f.recipient_email.trim()) ? null : "Hãy nhập email người nhận hợp lệ.");

  const save = async () => {
    if (!form) return;
    const bad = validate(form);
    if (bad) return setMsg({ kind: "err", text: bad });
    if (!(await ensureViewLink(form))) return;
    await run("save", async () => {
      const input = formToInput(form);
      if (form.id) await updateReport(dashboardId, form.id, input);
      else await createReport(dashboardId, input);
      setForm(null);
      setPreview(null);
      await load();
      setMsg({ kind: "ok", text: "Đã lưu." });
    });
  };

  const doPreview = async () => {
    if (!form) return;
    const bad = validate(form);
    if (bad) return setMsg({ kind: "err", text: bad });
    await run("preview", async () => setPreview(await previewReport(dashboardId, formToInput(form))));
  };

  const doTest = async () => {
    if (!form || !data) return;
    const bad = validate(form);
    if (bad) return setMsg({ kind: "err", text: bad });
    await run("test", async () => {
      const r = await sendTestReport(dashboardId, formToInput(form));
      setMsg({ kind: "ok", text: `Đã gửi thư thử tới ${r.to}. Hãy kiểm tra hộp thư (kể cả thư rác).` });
    });
  };

  const toggle = async (r: ReportRow) =>
    run("row", async () => {
      await updateReport(dashboardId, r.id, formToInput({ ...formFromRow(r), enabled: !r.enabled }));
      await load();
    });

  const remove = async (r: ReportRow) => {
    const ok = await dialog.confirm({
      title: "Xoá đăng ký báo cáo?",
      message: `Xoá việc gửi báo cáo cho ${r.recipient_email}? Thao tác này không khôi phục được.`,
      confirmText: "Xoá",
      tone: "danger",
    });
    if (!ok) return;
    await run("row", async () => {
      await deleteReport(dashboardId, r.id);
      await load();
    });
  };

  if (loadError) return <p className={n.err} role="alert">{loadError}</p>;
  if (!data) return <div className={s.shareLoading}><Spinner size={26} label="Đang tải…" /></div>;

  // ---------------- Biểu mẫu ----------------
  if (form) {
    const own = !data.isOwner;
    return (
      <div className={n.form}>
        <div className={n.top}>
          <strong>{form.id ? "Sửa báo cáo" : "Thêm người nhận báo cáo"}</strong>
        </div>

        <div className={n.grid2}>
          <label className={n.field}>
            Email người nhận
            <input type="email" value={form.recipient_email} disabled={own || busy !== null} maxLength={254}
              onChange={(e) => patch({ recipient_email: e.target.value })} />
          </label>
          <label className={n.field}>
            Tên người nhận (dùng trong lời chào)
            <input value={form.recipient_name} disabled={busy !== null} maxLength={80} placeholder="Nguyễn Văn An"
              onChange={(e) => patch({ recipient_name: e.target.value })} />
          </label>
        </div>

        <div className={n.grid3}>
          <label className={n.field}>
            Tần suất
            <select value={form.frequency} disabled={busy !== null} onChange={(e) => patch({ frequency: e.target.value as ReportForm["frequency"] })}>
              {(Object.keys(FREQUENCY_LABELS) as ReportForm["frequency"][]).map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
            </select>
          </label>
          {form.frequency === "weekly" && (
            <label className={n.field}>
              Thứ
              <select value={form.weekday} disabled={busy !== null} onChange={(e) => patch({ weekday: Number(e.target.value) })}>
                {WEEKDAY_LABELS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}
              </select>
            </label>
          )}
          {form.frequency === "monthly" && (
            <label className={n.field}>
              Ngày trong tháng
              <select value={form.month_day} disabled={busy !== null} onChange={(e) => patch({ month_day: Number(e.target.value) })}>
                {MONTH_DAYS.map((d) => <option key={d} value={d}>{d === 31 ? "31 (cuối tháng nếu tháng ngắn hơn)" : d}</option>)}
              </select>
            </label>
          )}
          <label className={n.field}>
            Giờ gửi (giờ Việt Nam)
            <select value={form.hour_vn} disabled={busy !== null} onChange={(e) => patch({ hour_vn: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </label>
        </div>

        <label className={n.field}>
          Yêu cầu riêng của người nhận (không bắt buộc)
          <textarea value={form.prompt} disabled={busy !== null} maxLength={MAX_PROMPT}
            placeholder="Ví dụ: Tập trung vào khu vực miền Bắc, nêu rõ 3 điểm yếu nhất, viết ngắn gọn."
            onChange={(e) => patch({ prompt: e.target.value })} />
          <span className={n.counter}>{form.prompt.length}/{MAX_PROMPT}</span>
        </label>
        <div className={n.chips}>
          {PROMPT_SUGGESTIONS.map((p) => (
            <button key={p.label} type="button" className={n.chip} disabled={busy !== null}
              onClick={() => patch({ prompt: appendSuggestion(form.prompt, p.text) })}>
              + {p.label}
            </button>
          ))}
        </div>

        <label className={n.check}>
          <input type="checkbox" checked={form.include_images} disabled={busy !== null} onChange={(e) => patch({ include_images: e.target.checked })} />
          <span>Kèm ảnh biểu đồ trong email</span>
        </label>
        {form.include_images && widgets.length > 0 && (
          <div className={n.field}>
            <span>{`Chọn tối đa ${MAX_WIDGETS} biểu đồ hoặc thẻ KPI (không chọn gì = tự chọn các biểu đồ)`}</span>
            <div className={n.widgets}>
              {widgets.map((w) => {
                const on = form.widget_ids.includes(w.id);
                return (
                  <label key={w.id} className={n.check}>
                    <input type="checkbox" checked={on} disabled={busy !== null || (!on && form.widget_ids.length >= MAX_WIDGETS)}
                      onChange={() => patch({ widget_ids: on ? form.widget_ids.filter((x) => x !== w.id) : [...form.widget_ids, w.id] })} />
                    <span>{w.label}{w.kind === "kpi" ? " (thẻ KPI)" : ""}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className={n.radios} role="radiogroup" aria-label="Link mở dashboard">
          <span className={n.legend}>Link “Mở dashboard” trong email</span>
          <label className={n.check}>
            <input type="radio" name="linkmode" checked={form.link_mode === "view_link"} disabled={busy !== null} onChange={() => patch({ link_mode: "view_link" })} />
            <span>Link xem công khai: người nhận mở được ngay, không cần đăng nhập</span>
          </label>
          <label className={n.check}>
            <input type="radio" name="linkmode" checked={form.link_mode === "login"} disabled={busy !== null} onChange={() => patch({ link_mode: "login" })} />
            <span>Link đăng nhập: người nhận phải được mời và đăng nhập bằng đúng email</span>
          </label>
        </div>

        <label className={n.check}>
          <input type="checkbox" checked={form.enabled} disabled={busy !== null} onChange={(e) => patch({ enabled: e.target.checked })} />
          <span>Đang bật (tắt để tạm dừng gửi)</span>
        </label>

        {msg && <p className={msg.kind === "ok" ? n.ok : n.err} role={msg.kind === "ok" ? "status" : "alert"}>{msg.text}</p>}

        {preview && (
          <div className={n.previewBox}>
            <span className={n.sub}>{`Tiêu đề: ${preview.subject}`}</span>
            <span className={n.sub}>
              {preview.meta.ai.used ? "Có phần phân tích do AI viết (đã kiểm các con số)." : "Báo cáo này không có phần AI (AI lỗi, không kiểm được số hoặc chưa bật)."}
              {` ${preview.meta.images} ảnh.`}
            </span>
            {/* Chỉ để XEM TRƯỚC trong ứng dụng: khung cách ly (sandbox, không chạy script). Email thật không dùng iframe. */}
            <iframe className={n.previewFrame} title="Xem trước email" sandbox="" srcDoc={preview.html} />
          </div>
        )}

        <div className={n.actions}>
          <button className={s.btn} onClick={() => { setForm(null); setPreview(null); setMsg(null); }} disabled={busy !== null}>Hủy</button>
          <button className={s.btn} onClick={doPreview} disabled={busy !== null}>
            {busy === "preview" ? <Spinner size={12} inline /> : null} Xem trước
          </button>
          <button className={s.btn} onClick={doTest} disabled={busy !== null}>
            {busy === "test" ? <Spinner size={12} inline /> : null} Gửi thử cho tôi
          </button>
          <button className={`${s.btn} ${s.btnActive}`} onClick={save} disabled={busy !== null}>
            {busy === "save" ? <Spinner size={12} inline /> : null} Lưu
          </button>
        </div>
      </div>
    );
  }

  // ---------------- Danh sách ----------------
  const full = data.subscriptions.length >= data.limit;
  return (
    <div className={n.body} style={{ padding: 0 }}>
      <div className={n.top}>
        <p>
          {data.isOwner
            ? "Gửi báo cáo số liệu của dashboard qua email theo lịch. Mỗi người nhận có thể có yêu cầu riêng."
            : "Đăng ký nhận báo cáo của dashboard này qua email của chính bạn."}
        </p>
        <button className={`${s.btn} ${s.btnActive}`} onClick={openNew} disabled={full || busy !== null}>
          <Icon name="plus" size={13} /> Thêm
        </button>
      </div>

      {!data.mailReady && (
        <p className={n.warn}>Máy chủ chưa cấu hình gửi email nên các báo cáo chưa được gửi đi. Bạn vẫn có thể tạo lịch và xem trước.</p>
      )}
      {full && <p className={n.warn}>{`Đã đạt giới hạn ${data.limit} người nhận cho dashboard này.`}</p>}
      {msg && <p className={msg.kind === "ok" ? n.ok : n.err} role={msg.kind === "ok" ? "status" : "alert"}>{msg.text}</p>}

      {data.subscriptions.length === 0 ? (
        <p className={n.empty}>Chưa có báo cáo nào. Bấm “Thêm” để tạo báo cáo đầu tiên.</p>
      ) : (
        <ul className={n.list}>
          {data.subscriptions.map((r) => (
            <li key={r.id} className={n.item}>
              <div className={n.itemHead}>
                <div className={n.itemMain}>
                  <strong>{r.recipient_name ? `${r.recipient_name} · ${r.recipient_email}` : r.recipient_email}</strong>
                  <span className={n.sub}>{scheduleParts(r).map((part, i) => <span key={i}>{i > 0 ? " · " : ""}{part}</span>)}</span>
                  <span className={n.sub}>
                    {r.enabled ? `Gửi tiếp: ${when(r.next_run_at)}` : "Đang tắt"}
                    {r.last_sent_at ? ` · Đã gửi gần nhất: ${when(r.last_sent_at)}` : ""}
                  </span>
                  {r.prompt && <span className={n.sub}>{`Yêu cầu: ${r.prompt.length > 120 ? `${r.prompt.slice(0, 120)}…` : r.prompt}`}</span>}
                  {r.last_error && <span className={n.err}>{r.last_error}</span>}
                </div>
                <span className={`${n.tag} ${r.enabled ? "" : n.tagOff}`}>{r.enabled ? "Đang bật" : "Tắt"}</span>
              </div>
              <div className={n.rowBtns}>
                <button className={s.btn} onClick={() => openEdit(r)} disabled={busy !== null}>Sửa</button>
                <button className={s.btn} onClick={() => toggle(r)} disabled={busy !== null}>{r.enabled ? "Tạm dừng" : "Bật lại"}</button>
                <button className={s.btn} onClick={() => remove(r)} disabled={busy !== null}>Xoá</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

/**
 * Hộp thoại "Thông báo" của dashboard. Hiện có tab "Báo cáo định kỳ"; tab "Cảnh báo" sẽ thêm vào cùng khung này.
 * Mở được cả từ trình xem (/d/<id>) để người được mời tự đăng ký nhận báo cáo cho email của mình.
 */
export function NotifyDialog({ dashboardId, widgets, onClose }: { dashboardId: string; widgets: ReportableWidget[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={s.modalBack} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${s.dialog} ${s.dialogShare}`} role="dialog" aria-modal="true" aria-label="Thông báo">
        <div className={s.shareHead}>
          <div className={s.shareHeadRow}>
            <strong>Báo cáo định kỳ qua email</strong>
            <button className={s.iconBtn} title="Đóng (Esc)" onClick={onClose}><Icon name="close" size={14} /></button>
          </div>
          <span className={s.shareSub}>Nhận số liệu mới nhất của dashboard vào hộp thư theo lịch bạn chọn, kèm phân tích ngắn và biểu đồ.</span>
        </div>
        <div className={s.shareBody}>
          <ReportsTab dashboardId={dashboardId} widgets={widgets} />
        </div>
        <div className={s.shareFoot}>
          <button className={s.btn} onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
