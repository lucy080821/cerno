"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAlert, deleteAlert, evaluateAlert, listAlerts, parseAlertText, snoozeAlert, updateAlert,
  type AlertList, type AlertRow, type Summary,
} from "@/lib/notify/alert-api";
import {
  AGG_NAMES, COOLDOWNS, KIND_NAMES, OP_NAMES, STATE_LABELS, WINDOW_NAMES, WINDOW_ORDER, columnChoices, earlyAlarmRisk, emptyAlertForm,
  formFromRule, formToDraft, formToRuleInput, previewParts, stateKey, type AlertForm, type AlertPrefill, type Aggregation, type ConditionKind,
} from "@/lib/notify/alert-form";
import { conditionSentence } from "@/lib/alerts/describe";
import { isPlanLimit } from "@/lib/notify/plan-error";
import { Spinner } from "@/components/Spinner";
import { useDialog } from "@/components/ui/DialogProvider";
import { UpgradeNote } from "@/components/upgrade/UpgradeNote";
import { showPlanLimit } from "@/lib/upgrade";
import { Icon } from "./fields";
import s from "./editor.module.css";
import n from "./notify.module.css";

type Msg = { kind: "ok" | "err"; text: string; /** Gợi ý đi kèm, tách riêng để dịch được. */ hint?: string } | null;

/** dd/mm/yyyy HH:mm theo giờ Việt Nam. */
function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const TAG_CLASS: Record<string, string> = { firing: n.tagBad, error: n.tagBad, snoozed: n.tagWarn, disabled: n.tagOff, insufficient: n.tagOff };

function PreviewBox({ summary, loading, error }: { summary: Summary | null; loading: boolean; error: string }) {
  if (loading) return <p className={n.sub}><Spinner size={12} inline /> Đang tính giá trị hiện tại…</p>;
  if (error) return <p className={n.err} role="alert">{error}</p>;
  if (!summary) return null;
  const p = previewParts(summary);
  const verdict =
    p.verdict === "firing" ? (
      <strong className={n.bad}>Bây giờ SẼ báo</strong>
    ) : p.verdict === "ok" ? (
      <strong className={n.good}>Bây giờ không báo</strong>
    ) : p.verdict === "deferred" ? (
      <strong>{`Chưa tới giờ chốt (${String(p.settleHour ?? 0).padStart(2, "0")}:00), chưa đánh giá`}</strong>
    ) : (
      <strong>Chưa đủ dữ liệu để đánh giá</strong>
    );
  return (
    <div className={n.preview} role="status">
      {p.kind === "single" && (
        <div>
          <span>Giá trị hiện tại:</span> <strong>{p.valueText ?? "—"}</strong> <span className={n.sub}>{p.label}</span> <span>→</span> {verdict}
        </div>
      )}
      {p.kind === "groups" && (
        <>
          <div>
            <span>Số nhóm đang vi phạm:</span> <strong>{p.valueText}</strong> <span className={n.sub}>{p.label}</span> <span>→</span> {verdict}
          </div>
          {(p.groups ?? []).length > 0 && <div className={n.sub}>{(p.groups ?? []).map((g) => `${g.group}: ${g.valueText}`).join(" · ")}</div>}
        </>
      )}
      {p.kind === "deferred" && <div>{verdict}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function AlertsTab({ dashboardId, prefill }: { dashboardId: string; prefill?: AlertPrefill | null }) {
  const dialog = useDialog();
  const [data, setData] = useState<AlertList | null>(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<AlertForm | null>(null);
  const [busy, setBusy] = useState<"save" | "ai" | "check" | "row" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [text, setText] = useState("");
  const [question, setQuestion] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [checkError, setCheckError] = useState("");
  const prefillUsed = useRef(false);

  const load = useCallback(async () => {
    try {
      setData(await listAlerts(dashboardId));
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Không tải được danh sách cảnh báo.");
    }
  }, [dashboardId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mở sẵn biểu mẫu khi tạo cảnh báo từ widget KPI (chỉ một lần, sau khi tải xong cấu trúc dashboard).
  useEffect(() => {
    if (data && prefill && !prefillUsed.current) {
      prefillUsed.current = true;
      setForm(emptyAlertForm(data.schema, data.me, prefill));
    }
  }, [data, prefill]);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setMsg(null);
    let limit: string | null = null;
    try {
      await fn();
    } catch (e) {
      if (isPlanLimit(e)) limit = e.message;
      else setMsg({ kind: "err", text: e instanceof Error ? e.message : "Có lỗi xảy ra." });
    } finally {
      setBusy(null);
    }
    // Chạm giới hạn của gói: hộp thoại riêng (hiện SAU khi lớp phủ "đang xử lý" đã tắt).
    if (limit) await showPlanLimit(dialog, limit);
  };

  const patch = (p: Partial<AlertForm>) => {
    setForm((f) => (f ? { ...f, ...p } : f));
    setSummary(null);
    setCheckError("");
  };

  const closeForm = () => {
    setForm(null);
    setSummary(null);
    setCheckError("");
    setMsg(null);
  };

  const openManual = () => {
    if (!data) return;
    setMsg(null);
    setQuestion("");
    setSummary(null);
    setForm(emptyAlertForm(data.schema, data.me));
  };

  const askAi = async () => {
    if (!data) return;
    if (text.trim().length < 3) return setMsg({ kind: "err", text: "Hãy mô tả điều bạn muốn được báo." });
    await run("ai", async () => {
      setQuestion("");
      const r = await parseAlertText(dashboardId, text.trim());
      if (!r.ai) {
        setMsg({ kind: "err", text: r.error, hint: "Bạn vẫn có thể dùng “Tự cài”." });
        return;
      }
      if ("question" in r) return setQuestion(r.question);
      if ("invalid" in r) return setMsg({ kind: "err", text: r.errors[0], hint: "Hãy mô tả lại rõ hơn hoặc dùng “Tự cài”." });
      setForm(formFromRule({ ...r.draft, recipients: [data.me] }, data.schema, data.me));
      setSummary(r.summary);
      setText("");
    });
  };

  const check = async () => {
    if (!form) return;
    const d = formToDraft(form);
    if (!d.ok) return setCheckError(d.error);
    setBusy("check");
    setCheckError("");
    try {
      setSummary((await evaluateAlert(dashboardId, d.draft)).summary);
    } catch (e) {
      setSummary(null);
      setCheckError(e instanceof Error ? e.message : "Không kiểm tra được.");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!form || !data) return;
    const r = formToRuleInput(form, { isOwner: data.isOwner, me: data.me });
    if (!r.ok) return setMsg({ kind: "err", text: r.error });
    await run("save", async () => {
      if (form.id) await updateAlert(dashboardId, form.id, r.input);
      else await createAlert(dashboardId, r.input);
      closeForm();
      await load();
      setMsg({ kind: "ok", text: "Đã lưu." });
    });
  };

  const toggle = (r: AlertRow) =>
    run("row", async () => {
      if (!data) return;
      const f = formFromRule(r, data.schema, data.me);
      const out = formToRuleInput({ ...f, enabled: !r.enabled }, { isOwner: data.isOwner, me: data.me });
      if (!out.ok) throw new Error(out.error);
      await updateAlert(dashboardId, r.id, out.input);
      await load();
    });

  const snooze = (r: AlertRow, hours: number) =>
    run("row", async () => {
      await snoozeAlert(dashboardId, r.id, hours);
      await load();
    });

  const remove = async (r: AlertRow) => {
    const ok = await dialog.confirm({
      title: "Xoá cảnh báo?",
      message: `Xoá cảnh báo “${r.name}”? Thao tác này không khôi phục được.`,
      confirmText: "Xoá",
      tone: "danger",
    });
    if (!ok) return;
    await run("row", async () => {
      await deleteAlert(dashboardId, r.id);
      await load();
    });
  };

  if (loadError) return <p className={n.err} role="alert">{loadError}</p>;
  if (!data) return <div className={s.shareLoading}><Spinner size={26} label="Đang tải…" /></div>;

  // ---------------- Biểu mẫu ----------------
  if (form) {
    const ch = columnChoices(data.schema, form.sourceId);
    const stale = form.kind === "stale";
    const isCalc = ch.calc.includes(form.column);
    const own = !data.isOwner;
    const disabled = busy !== null;
    const risk = earlyAlarmRisk(form);
    const types = data.limits.types;
    const allowed = (k: ConditionKind) => types.includes(k);
    const groupAllowed = types.includes("per_group");
    return (
      <div className={n.form}>
        <div className={n.top}><strong>{form.id ? "Sửa cảnh báo" : "Thêm cảnh báo"}</strong></div>

        {form.source_prompt && <p className={n.sub}>{`Bạn đã mô tả: “${form.source_prompt}”`}</p>}

        <label className={n.field}>
          Tên cảnh báo
          <input value={form.name} maxLength={120} disabled={disabled} placeholder="Doanh thu hôm nay thấp" onChange={(e) => patch({ name: e.target.value })} />
        </label>

        {data.schema.sources.length > 1 && (
          <label className={n.field}>
            Nguồn dữ liệu
            <select value={form.sourceId} disabled={disabled} onChange={(e) => {
              const c2 = columnChoices(data.schema, e.target.value);
              patch({ sourceId: e.target.value, column: c2.numeric[0] ?? c2.metric[0] ?? "", dateColumn: c2.date[0] ?? "", groupBy: "", filters: [] });
            }}>
              {data.schema.sources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}

        {(!allowed("anomaly") || !allowed("stale") || !groupAllowed) && <p className={n.sub}>Các loại bị khoá và báo theo từng nhóm chỉ có ở gói trả phí.</p>}
        <label className={n.field}>
          Loại cảnh báo
          <select value={form.kind} disabled={disabled} onChange={(e) => {
            const kind = e.target.value as ConditionKind;
            patch({ kind, ...(kind === "change" || kind === "anomaly" ? { window: form.window === "all" ? "yesterday" : form.window } : {}) });
          }}>
            {(Object.keys(KIND_NAMES) as ConditionKind[]).map((k) => (
              <option key={k} value={k} disabled={!allowed(k)}>{KIND_NAMES[k]}</option>
            ))}
          </select>
        </label>

        {!stale && (
          <>
            <div className={n.grid2}>
              <label className={n.field}>
                Chỉ số (cột)
                <select value={form.column} disabled={disabled} onChange={(e) => patch({ column: e.target.value })}>
                  {ch.metric.map((c) => <option key={c} value={c}>{ch.calc.includes(c) ? `${c} (trường tính toán)` : c}</option>)}
                </select>
              </label>
              <label className={n.field}>
                Cách tính
                <select value={form.aggregation} disabled={disabled || isCalc} onChange={(e) => patch({ aggregation: e.target.value as Aggregation })}>
                  {(Object.keys(AGG_NAMES) as Aggregation[]).map((a) => <option key={a} value={a}>{AGG_NAMES[a]}</option>)}
                </select>
              </label>
            </div>

            <div className={n.grid2}>
              <label className={n.field}>
                Khoảng thời gian
                <select value={form.window} disabled={disabled} onChange={(e) => patch({ window: e.target.value as AlertForm["window"] })}>
                  {WINDOW_ORDER.filter((w) => w !== "all" || form.kind === "threshold").map((w) => <option key={w} value={w}>{WINDOW_NAMES[w]}</option>)}
                </select>
              </label>
              {form.window !== "all" && (
                <label className={n.field}>
                  Cột ngày
                  <select value={form.dateColumn} disabled={disabled} onChange={(e) => patch({ dateColumn: e.target.value })}>
                    {ch.date.length === 0 && <option value="">(nguồn không có cột ngày)</option>}
                    {ch.date.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}
            </div>
          </>
        )}

        {/* Điều kiện */}
        {form.kind === "threshold" && (
          <div className={n.grid2}>
            <label className={n.field}>
              Báo khi giá trị
              <select value={form.op} disabled={disabled} onChange={(e) => patch({ op: e.target.value as AlertForm["op"] })}>
                {(Object.keys(OP_NAMES) as (keyof typeof OP_NAMES)[]).map((o) => <option key={o} value={o}>{OP_NAMES[o]}</option>)}
              </select>
            </label>
            <label className={n.field}>
              Ngưỡng
              <input inputMode="decimal" value={form.value} disabled={disabled} placeholder="10.000.000" onChange={(e) => patch({ value: e.target.value })} />
            </label>
          </div>
        )}
        {form.kind === "change" && (
          <div className={n.grid3}>
            <label className={n.field}>
              Báo khi
              <select value={form.changeOp} disabled={disabled} onChange={(e) => patch({ changeOp: e.target.value as AlertForm["changeOp"] })}>
                <option value="drop_pct">Giảm</option>
                <option value="rise_pct">Tăng</option>
              </select>
            </label>
            <label className={n.field}>
              Từ (%)
              <input inputMode="decimal" value={form.changeValue} disabled={disabled} onChange={(e) => patch({ changeValue: e.target.value })} />
            </label>
            <label className={n.field}>
              So với
              <select value={form.vs} disabled={disabled} onChange={(e) => patch({ vs: e.target.value as AlertForm["vs"] })}>
                <option value="prev_period">Kỳ trước</option>
                <option value="prev_year">Cùng kỳ năm ngoái</option>
              </select>
            </label>
          </div>
        )}
        {form.kind === "anomaly" && (
          <div className={n.grid3}>
            <label className={n.field}>
              Độ nhạy
              <select value={form.sensitivity} disabled={disabled} onChange={(e) => patch({ sensitivity: e.target.value as AlertForm["sensitivity"] })}>
                <option value="low">Thấp (ít báo)</option>
                <option value="medium">Trung bình</option>
                <option value="high">Cao (báo nhiều)</option>
              </select>
            </label>
            <label className={n.field}>
              Hướng
              <select value={form.direction} disabled={disabled} onChange={(e) => patch({ direction: e.target.value as AlertForm["direction"] })}>
                <option value="both">Tăng hoặc giảm</option>
                <option value="up">Chỉ khi tăng</option>
                <option value="down">Chỉ khi giảm</option>
              </select>
            </label>
            <label className={n.field}>
              So với số kỳ trước
              <select value={form.lookback} disabled={disabled} onChange={(e) => patch({ lookback: Number(e.target.value) })}>
                {[4, 6, 8, 10, 12].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
          </div>
        )}
        {stale && (
          <label className={n.field}>
            Báo khi không có dữ liệu mới trong (giờ)
            <input inputMode="numeric" value={form.staleHours} disabled={disabled} onChange={(e) => patch({ staleHours: e.target.value })} />
          </label>
        )}

        {!stale && (
          <>
            <label className={n.check}>
              <input type="checkbox" checked={form.perGroup} disabled={disabled || !groupAllowed} onChange={(e) => patch({ perGroup: e.target.checked, groupBy: e.target.checked ? form.groupBy || ch.group[0] || "" : "" })} />
              <span>Báo theo từng nhóm (mỗi giá trị của một cột được kiểm riêng)</span>
            </label>
            {form.perGroup && (
              <label className={n.field}>
                Nhóm theo cột
                <select value={form.groupBy} disabled={disabled} onChange={(e) => patch({ groupBy: e.target.value })}>
                  {ch.group.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            )}
            {form.filters.length > 0 && (
              <div className={n.field}>
                <span>Chỉ tính các dòng</span>
                <div className={n.chips}>
                  {form.filters.map((f, i) => (
                    <button key={`${f.column}-${i}`} type="button" className={n.chip} disabled={disabled} title="Bấm để bỏ bộ lọc này"
                      onClick={() => patch({ filters: form.filters.filter((_, j) => j !== i) })}>
                      {`${f.column} = ${f.values.join(", ")} ×`}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {form.window !== "all" && (form.window === "today" || form.window === "this_week" || form.window === "this_month") && (
              <div className={n.field}>
                {risk && <p className={n.warn}>Khoảng này chưa kết thúc nên cảnh báo có thể báo sớm (ví dụ 9 giờ sáng doanh thu hôm nay chắc chắn còn thấp). Nên chọn giờ chốt bên dưới.</p>}
                <label className={n.field}>
                  Chỉ báo sau giờ (giờ Việt Nam)
                  <select value={form.settleHour ?? ""} disabled={disabled} onChange={(e) => patch({ settleHour: e.target.value === "" ? null : Number(e.target.value) })}>
                    <option value="">Không giới hạn (báo ngay)</option>
                    {HOURS.map((h) => <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>)}
                  </select>
                </label>
              </div>
            )}
          </>
        )}

        <label className={n.field}>
          Người nhận (email){own ? " — chỉ gửi tới email của bạn" : ""}
          <textarea value={own ? data.me : form.recipients} disabled={disabled || own} rows={2} placeholder="an@congty.com, binh@congty.com"
            onChange={(e) => patch({ recipients: e.target.value })} />
        </label>

        <div className={n.grid2}>
          <label className={n.field}>
            Thời gian chờ giữa 2 lần báo
            <select value={form.cooldown_minutes} disabled={disabled} onChange={(e) => patch({ cooldown_minutes: Number(e.target.value) })}>
              {!COOLDOWNS.some((c) => c.minutes === form.cooldown_minutes) && <option value={form.cooldown_minutes}>{`${form.cooldown_minutes} phút`}</option>}
              {COOLDOWNS.map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
            </select>
          </label>
          <div className={n.radios}>
            <label className={n.check}>
              <input type="checkbox" checked={form.notify_recover} disabled={disabled} onChange={(e) => patch({ notify_recover: e.target.checked })} />
              <span>Báo cả khi trở lại bình thường</span>
            </label>
            <label className={n.check}>
              <input type="checkbox" checked={form.enabled} disabled={disabled} onChange={(e) => patch({ enabled: e.target.checked })} />
              <span>Đang bật</span>
            </label>
          </div>
        </div>

        <PreviewBox summary={summary} loading={busy === "check"} error={checkError} />
        {msg && <p className={msg.kind === "ok" ? n.ok : n.err} role={msg.kind === "ok" ? "status" : "alert"}>{msg.text}{msg.hint ? <> {msg.hint}</> : null}</p>}

        <div className={n.actions}>
          <button className={s.btn} onClick={closeForm} disabled={disabled}>Hủy</button>
          {!stale && (
            <button className={s.btn} onClick={check} disabled={disabled}>
              {busy === "check" ? <Spinner size={12} inline /> : null} Kiểm tra bây giờ
            </button>
          )}
          <button className={`${s.btn} ${s.btnActive}`} onClick={save} disabled={disabled}>
            {busy === "save" ? <Spinner size={12} inline /> : null} Lưu
          </button>
        </div>
      </div>
    );
  }

  // ---------------- Danh sách ----------------
  const full = data.rules.length >= data.limit;
  const now = new Date();
  const calcNames = data.schema.calc.map((c) => c.name);
  return (
    <div className={n.body} style={{ padding: 0 }}>
      <div className={n.top}>
        <p>
          {data.isOwner ? "Nhận email khi số liệu chạm ngưỡng hoặc bất thường. Mô tả bằng lời, hệ thống dựng luật để bạn xác nhận." : "Tạo cảnh báo gửi tới email của chính bạn."}{" "}
          <span>Gói:</span> <span className={n.tag}>{data.planLabel}</span>
        </p>
      </div>

      {data.plan === "free" && <UpgradeNote />}
      {!data.mailReady && <p className={n.warn}>Máy chủ chưa cấu hình gửi email nên các cảnh báo chưa được gửi đi. Bạn vẫn có thể tạo và kiểm tra luật.</p>}
      {full && <p className={n.warn}>{`Đã đạt giới hạn ${data.limit} cảnh báo cho dashboard này.`}</p>}

      <div className={n.item}>
        <label className={n.field}>
          Mô tả điều bạn muốn được báo
          <textarea value={text} maxLength={500} disabled={busy !== null || full} rows={2}
            placeholder="Ví dụ: báo khi doanh thu hôm nay dưới 10 triệu · báo khi số đơn huỷ tăng bất thường · báo khi tỉnh nào doanh thu giảm hơn 20%"
            onChange={(e) => setText(e.target.value)} />
        </label>
        {data.limits.aiParsePerMonth !== null && <p className={n.sub}>{`Tạo cảnh báo bằng AI: tối đa ${data.limits.aiParsePerMonth} lần mỗi tháng.`}</p>}
        {question && <p className={n.warn}>{`AI hỏi: ${question}`}</p>}
        <div className={n.actions}>
          <button className={s.btn} onClick={openManual} disabled={busy !== null || full}>Tự cài</button>
          <button className={`${s.btn} ${s.btnActive}`} onClick={askAi} disabled={busy !== null || full}>
            {busy === "ai" ? <Spinner size={12} inline /> : <Icon name="plus" size={13} />} Tạo bằng AI
          </button>
        </div>
      </div>

      {msg && <p className={msg.kind === "ok" ? n.ok : n.err} role={msg.kind === "ok" ? "status" : "alert"}>{msg.text}{msg.hint ? <> {msg.hint}</> : null}</p>}

      {data.rules.length === 0 ? (
        <p className={n.empty}>Chưa có cảnh báo nào.</p>
      ) : (
        <ul className={n.list}>
          {data.rules.map((r) => {
            const key = stateKey(r, now);
            let sentence = "";
            try {
              sentence = conditionSentence(r.condition, r.metric, WINDOW_NAMES[r.metric.window], { calcNames });
            } catch {
              sentence = "";
            }
            const snoozed = key === "snoozed";
            return (
              <li key={r.id} className={n.item}>
                <div className={n.itemHead}>
                  <div className={n.itemMain}>
                    <strong>{r.name}</strong>
                    {sentence && <span className={n.sub}>{sentence}</span>}
                    <span className={n.sub}>
                      {`Báo gần nhất: ${when(r.last_triggered_at)}`}
                      {r.last_checked_at ? ` · Kiểm tra lúc: ${when(r.last_checked_at)}` : ""}
                      {r.last_value !== null ? ` · Giá trị: ${r.last_value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}` : ""}
                    </span>
                    {snoozed && <span className={n.sub}>{`Tạm hoãn đến: ${when(r.snooze_until)}`}</span>}
                    {r.last_error && <span className={n.err}>{r.last_error}</span>}
                  </div>
                  <span className={`${n.tag} ${TAG_CLASS[key] ?? ""}`}>{STATE_LABELS[key]}</span>
                </div>
                <div className={n.rowBtns}>
                  <button className={s.btn} onClick={() => setForm(formFromRule(r, data.schema, data.me))} disabled={busy !== null}>Sửa</button>
                  <button className={s.btn} onClick={() => snooze(r, snoozed ? 0 : 24)} disabled={busy !== null || !r.enabled}>{snoozed ? "Bỏ tạm hoãn" : "Tạm hoãn 24 giờ"}</button>
                  <button className={s.btn} onClick={() => toggle(r)} disabled={busy !== null}>{r.enabled ? "Tắt" : "Bật"}</button>
                  <button className={s.btn} onClick={() => remove(r)} disabled={busy !== null}>Xoá</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
