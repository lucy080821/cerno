"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyTemplate, matchColumns, TemplateError } from "@dashboard/schema";
import { sampleSheetCopyUrl, type TemplateEntry } from "@/content/templates";
import { createDashboard } from "@/lib/dashboards/api";
import { sourceColumns, toDataSource, type TemplateSource } from "@/lib/templates/source";
import { Spinner } from "@/components/Spinner";
import { ConnectSheet } from "./ConnectSheet";
import dash from "./dashboards.module.css";
import styles from "./templates.module.css";

interface Props {
  entry: TemplateEntry;
  sources: TemplateSource[];
  apiKey: string;
  appId: string;
  onClose: () => void;
}

type Mapping = Record<string, string>;

/**
 * Tạo dashboard từ mẫu: chọn nguồn → tự khớp cột (luật, rồi AI nếu còn sót vai bắt buộc) → người dùng chỉnh → Tạo.
 * Việc áp mẫu chạy ở trình duyệt (`applyTemplate`), lưu bằng `createDashboard` như mọi dashboard khác.
 */
export function TemplateMapDialog({ entry, sources, apiKey, appId, onClose }: Props) {
  const router = useRouter();
  const t = entry.template;
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [mapping, setMapping] = useState<Mapping>({});
  const [ruleKeys, setRuleKeys] = useState<Set<string>>(new Set());
  const [aiKeys, setAiKeys] = useState<Set<string>>(new Set());
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const reqRef = useRef(0);
  const aiCache = useRef(new Map<string, Mapping>());
  const prevCount = useRef(sources.length);

  // Vừa kết nối thêm nguồn (danh sách mới nhất đứng đầu): chọn luôn nguồn đó.
  useEffect(() => {
    if (sources.length > prevCount.current && sources[0]) setSourceId(sources[0].id);
    prevCount.current = sources.length;
  }, [sources]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Khớp cột mỗi khi đổi nguồn. Không phụ thuộc `sources` để lần làm mới danh sách không xoá lựa chọn của người dùng.
  useEffect(() => {
    const token = ++reqRef.current;
    setError("");
    setAiBusy(false);
    const src = sourcesRef.current.find((s) => s.id === sourceId);
    if (!src) {
      setMapping({});
      setRuleKeys(new Set());
      setAiKeys(new Set());
      return;
    }
    const cols = sourceColumns(src);
    const r = matchColumns(t.slots, cols);
    const base: Mapping = { ...r.mapping };
    setRuleKeys(new Set(Object.keys(base)));
    setAiKeys(new Set());

    const fill = (ai: Mapping) => {
      const used = new Set(Object.values(base));
      const added = new Set<string>();
      for (const [k, col] of Object.entries(ai)) {
        if (!base[k] && !used.has(col)) {
          base[k] = col;
          used.add(col);
          added.add(k);
        }
      }
      setMapping({ ...base });
      setAiKeys(added);
    };
    setMapping(base);

    const missingRequired = t.slots.some((s) => s.required && !base[s.key]);
    if (!missingRequired) return;
    const cacheKey = `${t.id}:${sourceId}`;
    const cached = aiCache.current.get(cacheKey);
    if (cached) return fill(cached);

    setAiBusy(true);
    void (async () => {
      let ai: Mapping = {};
      try {
        const res = await fetch("/api/templates/match", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ templateId: t.id, sourceId, slots: r.unmatched, taken: Object.values(base) }),
        });
        const json = (await res.json().catch(() => ({}))) as { mapping?: Mapping };
        if (res.ok && json.mapping) ai = json.mapping;
      } catch {
        /* AI lỗi: người dùng tự chọn cột bằng tay */
      }
      if (token !== reqRef.current) return;
      aiCache.current.set(cacheKey, ai);
      setAiBusy(false);
      fill(ai);
    })();
  }, [sourceId, t]);

  const src = sources.find((s) => s.id === sourceId);
  const cols = useMemo(() => (src ? sourceColumns(src) : []), [src]);
  const missingRequired = t.slots.filter((s) => s.required && !mapping[s.key]);

  const built = useMemo(() => {
    if (!src || missingRequired.length) return null;
    try {
      return { result: applyTemplate(t, mapping, toDataSource(src)), error: "" };
    } catch (e) {
      return { result: null, error: e instanceof TemplateError ? e.message : "Không dựng được dashboard từ mẫu." };
    }
  }, [src, t, mapping, missingRequired.length]);

  const setSlot = (key: string, col: string) => {
    setMapping((m) => ({ ...m, [key]: col }));
    setRuleKeys((s) => { const n = new Set(s); n.delete(key); return n; });
    setAiKeys((s) => { const n = new Set(s); n.delete(key); return n; });
  };

  const create = async () => {
    const result = built?.result;
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      const id = await createDashboard(result.doc);
      router.push(`/editor/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra.");
      setBusy(false);
    }
  };

  const droppedCount = built?.result?.dropped.widgets.length ?? 0;

  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="tpl-title">
        {busy && (
          <div className={styles.busy}>
            <Spinner size={32} label="Đang tạo dashboard…" />
          </div>
        )}
        <h2 id="tpl-title" className={styles.dialogTitle}>{`Tạo từ mẫu “${t.name}”`}</h2>
        <p className={styles.sub}>
          Chọn Google Sheet chứa dữ liệu của bạn. Cerno tự ghép các cột với từng mục của mẫu; bạn có thể đổi lại nếu chưa đúng.
        </p>

        {sources.length === 0 ? (
          <p className={styles.note}>Bạn chưa kết nối Google Sheet nào. Kết nối một Sheet để tiếp tục.</p>
        ) : (
          <label className={styles.field}>
            Nguồn dữ liệu
            <select className={styles.select} value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={busy}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.name ?? s.sheet_name}</option>
              ))}
            </select>
          </label>
        )}

        <div className={styles.sheetLinks}>
          <ConnectSheet apiKey={apiKey} appId={appId} />
          {entry.sampleSheetId && (
            <a className={dash.ghost} href={sampleSheetCopyUrl(entry.sampleSheetId)} target="_blank" rel="noopener noreferrer">
              Sao chép Sheet mẫu
            </a>
          )}
        </div>

        {src && (
          <div className={styles.slots}>
            {aiBusy && (
              <p className={styles.sub}><Spinner size={12} inline /> AI đang gợi ý các cột còn thiếu…</p>
            )}
            {t.slots.map((s) => {
              const cur = mapping[s.key] ?? "";
              const curType = cols.find((c) => c.name === cur)?.type;
              const sameType = cols.filter((c) => c.type === s.type);
              const other = cols.filter((c) => c.type !== s.type);
              const bad = !!cur && curType !== s.type;
              return (
                <div key={s.key} className={styles.slotRow}>
                  <div className={styles.slotLabel}>
                    {s.label}
                    {s.required && <span className={styles.star} title="Bắt buộc">*</span>}
                    {ruleKeys.has(s.key) && <span className={styles.badge}>Tự khớp</span>}
                    {aiKeys.has(s.key) && <span className={`${styles.badge} ${styles.badgeAi}`}>AI gợi ý</span>}
                  </div>
                  <select
                    className={`${styles.select} ${bad ? styles.selectBad : ""}`}
                    value={cur}
                    disabled={busy}
                    aria-label={s.label}
                    onChange={(e) => setSlot(s.key, e.target.value)}
                  >
                    <option value="">{s.required ? "— Chọn cột —" : "— Không dùng —"}</option>
                    {sameType.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    {other.length > 0 && (
                      <optgroup label="Cột kiểu khác">
                        {other.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </optgroup>
                    )}
                  </select>
                </div>
              );
            })}
          </div>
        )}

        {src && missingRequired.length > 0 && !aiBusy && (
          <p className={styles.note}>{`Còn ${missingRequired.length} mục bắt buộc (*) chưa có cột. Hãy chọn cột cho các mục đó.`}</p>
        )}
        {droppedCount > 0 && (
          <p className={styles.note}>
            {`${droppedCount} biểu đồ sẽ không được thêm vì mẫu cần các mục bạn chưa chọn cột. Có thể thêm sau trong editor.`}
          </p>
        )}
        {(error || built?.error) && <p className={styles.error} role="alert">{error || built?.error}</p>}

        <div className={styles.actions}>
          <button className={dash.ghost} onClick={onClose} disabled={busy}>Hủy</button>
          <button className={dash.primary} onClick={create} disabled={busy || aiBusy || !built?.result}>
            Tạo dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
