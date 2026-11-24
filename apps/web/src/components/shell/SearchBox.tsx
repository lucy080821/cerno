"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n/store";
import { searchEntries, suggestedEntries } from "@/lib/search/match";
import type { SearchEntry } from "@/lib/search/entries";
import type { SearchHits } from "@/app/api/search/route";
import { useShell } from "@/lib/shell/store";
import { NavIcon, type NavIconName } from "./NavIcon";
import styles from "./shellbar.module.css";

type Item = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: NavIconName;
  /** Dữ liệu của người dùng (tên dashboard, SKU...) không dịch. */
  data?: boolean;
  hintData?: boolean;
  href?: string;
  run?: SearchEntry["run"] | "ask";
  text?: string;
};

const RECENT_KEY = "cerno.search.recent";
const MAX_RECENT = 5;

const GROUP = { page: "Trang và tính năng", action: "Hành động", dashboard: "Dashboard", source: "Nguồn dữ liệu", product: "Sản phẩm của bạn", order: "Đơn hàng", recent: "Đã mở gần đây", suggest: "Gợi ý", ai: "Hỏi AI" } as const;

const ICON: Record<string, NavIconName> = {
  "page:overview": "home", "page:sources": "database", "page:orders": "list", "page:products": "box", "page:costs": "wallet", "page:dashboards": "grid",
  "page:profit": "trend", "page:returns": "return", "page:ai": "sparkle", "page:todos": "check", "page:alerts": "bell", "page:reports": "mail",
  "page:templates": "templates", "page:sharing": "share",
};
const iconOf = (e: SearchEntry): NavIconName => ICON[e.id] ?? (e.kind === "action" ? "sparkle" : "grid");

const fromEntry = (e: SearchEntry, group: string): Item => ({ id: e.id, group, label: e.label, hint: e.hint, icon: iconOf(e), href: e.href, run: e.run });

type Recent = { id: string; label: string; href: string; icon: NavIconName; data?: boolean };
function readRecent(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((r): r is Recent => !!r && typeof r.href === "string" && typeof r.label === "string" && String(r.href).startsWith("/")).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}
function pushRecent(r: Recent) {
  try {
    const next = [r, ...readRecent().filter((x) => x.id !== r.id)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage bị chặn */
  }
}

/**
 * Ô tìm kiếm ở thanh trên: gợi ý theo từ khoá ngay khi gõ. Trang và hành động tìm tại máy (không phân biệt dấu, hiểu từ đồng nghĩa
 * và tiếng Anh); dashboard, nguồn, sản phẩm, mã đơn hỏi server sau khi ngừng gõ ~200ms. Dòng cuối luôn là "Hỏi AI: ..." để chuyển
 * câu vừa gõ sang khung chat. Phím: Ctrl/⌘+K để mở, ↑ ↓ chọn, Enter mở, Esc đóng.
 */
export function SearchBox() {
  const router = useRouter();
  const askAi = useShell((s) => s.askAi);
  const closeSide = useShell((s) => s.closeSide);
  const toggleLang = useLang((s) => s.setLang);
  const lang = useLang((s) => s.lang);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<SearchHits | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const query = q.trim();

  // Ctrl/⌘+K mở ô tìm kiếm ở bất cứ trang nào.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Bấm ra ngoài thì đóng.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) setRecent(readRecent());
  }, [open]);

  // Dữ liệu của người dùng: chờ ngừng gõ rồi mới hỏi server, bỏ kết quả của câu gõ cũ.
  useEffect(() => {
    if (query.length < 2) {
      setHits(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctl.signal, cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<SearchHits>) : null))
        .then((d) => d && setHits(d))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query]);

  const items = useMemo<Item[]>(() => {
    if (!query) {
      const r: Item[] = recent.map((x) => ({ id: x.id, group: GROUP.recent, label: x.label, icon: x.icon, data: x.data, href: x.href }));
      const seen = new Set(r.map((x) => x.id));
      return [...r, ...suggestedEntries().filter((e) => !seen.has(e.id)).map((e) => fromEntry(e, GROUP.suggest))];
    }
    const out: Item[] = searchEntries(query, 7).map((e) => fromEntry(e, e.kind === "page" ? GROUP.page : GROUP.action));
    if (hits) {
      for (const d of hits.dashboards) out.push({ id: `d:${d.id}`, group: GROUP.dashboard, label: d.name, icon: "grid", data: true, href: `/editor/${d.id}` });
      for (const s of hits.sources) out.push({ id: `s:${s.id}`, group: GROUP.source, label: s.name, icon: "database", data: true, href: "/sources" });
      for (const p of hits.products) out.push({ id: `p:${p.key}`, group: GROUP.product, label: p.name, hint: p.key, icon: "box", data: true, href: `/orders?q=${encodeURIComponent(p.key)}` });
      for (const o of hits.orders) out.push({ id: `o:${o.channel}:${o.id}`, group: GROUP.order, label: o.id, hint: o.channel, icon: "list", data: true, href: `/orders?q=${encodeURIComponent(o.id)}` });
    }
    out.push({ id: "ask", group: GROUP.ai, label: "Hỏi AI", hint: query, hintData: true, icon: "sparkle", run: "ask", text: query });
    return out;
  }, [query, hits, recent]);

  useEffect(() => setActive(0), [query, hits]);

  const close = useCallback(() => {
    setOpen(false);
    inputRef.current?.blur();
  }, []);

  const choose = useCallback(
    async (it: Item) => {
      close();
      if (it.run === "ask") {
        askAi(it.text ?? "");
        setQ("");
        return;
      }
      if (it.run === "toggle-lang") {
        toggleLang(lang === "vi" ? "en" : "vi");
        return;
      }
      if (it.run === "sign-out") {
        await createClient().auth.signOut();
        window.location.assign("/");
        return;
      }
      if (it.href) {
        pushRecent({ id: it.id, label: it.label, href: it.href, icon: it.icon, data: it.data });
        closeSide();
        setQ("");
        router.push(it.href);
      }
    },
    [askAi, close, closeSide, lang, router, toggleLang],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      const it = items[active];
      if (it) {
        e.preventDefault();
        void choose(it);
      }
    } else if (e.key === "Escape") {
      if (q) setQ("");
      else close();
    }
  };

  useEffect(() => {
    if (!open) return;
    document.getElementById(`sb-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  let lastGroup = "";
  return (
    <div className={styles.search} ref={boxRef}>
      <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        className={styles.searchInput}
        type="search"
        value={q}
        placeholder="Tìm trang, tính năng, dashboard, sản phẩm, mã đơn…"
        aria-label="Tìm kiếm"
        role="combobox"
        aria-expanded={open}
        aria-controls="sb-list"
        aria-activedescendant={open && items[active] ? `sb-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        maxLength={80}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {!q && <kbd className={styles.kbd} aria-hidden data-i18n-skip>Ctrl K</kbd>}
      {open && (
        <div className={styles.results} id="sb-list" role="listbox">
          {items.map((it, i) => {
            const head = it.group !== lastGroup;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {head && <div className={styles.resGroup}>{it.group}</div>}
                <button
                  type="button"
                  id={`sb-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`${styles.res} ${i === active ? styles.resOn : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void choose(it)}
                >
                  <span className={styles.resIcon}><NavIcon name={it.icon} size={16} /></span>
                  <span className={styles.resText}>
                    {it.data ? <b data-i18n-skip>{it.label}</b> : <b>{it.label}</b>}
                    {it.hint && ((it.hintData ?? it.data) ? <span data-i18n-skip>{it.hint}</span> : <span>{it.hint}</span>)}
                  </span>
                </button>
              </div>
            );
          })}
          {query && items.length === 1 && <div className={styles.resEmpty}>Không thấy trang hoặc dữ liệu khớp. Bạn có thể hỏi AI ngay bên dưới.</div>}
        </div>
      )}
    </div>
  );
}
