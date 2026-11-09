import { create } from "zustand";
import {
  DEFAULT_NAV, DEFAULT_PAGE_ID, MAX_PAGES, getPages, pageIdOf, resolvePageId, widgetsOnPage,
  type Dashboard, type Page, type PageNav, type Widget,
} from "@dashboard/schema";
import { aabb, union } from "./geometry";
import { newId } from "./defaults";
import { applyFormat, type FormatPart } from "./widget-format";

export interface View {
  zoom: number;
  x: number;
  y: number;
}

export type AlignKind = "left" | "centerX" | "right" | "top" | "centerY" | "bottom";
export type OrderKind = "front" | "back" | "forward" | "backward";

const HISTORY_LIMIT = 100;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;

/** Bộ lọc chéo tạm thời (không lưu vào dashboard): bấm một cột/lát của chart để lọc mọi chart khác. */
export interface CrossFilter {
  column: string;
  values: string[];
  /** Chart đã tạo ra bộ lọc: không tự lọc chính nó để vẫn thấy các cột khác và bỏ chọn được. */
  originId: string;
}

/** Giá trị đang chọn của một bộ lọc dashboard (trạng thái xem, không lưu vào JSON). */
export interface FilterValue {
  values?: string[];
  min?: number;
  max?: number;
  /** Khoảng ngày ISO yyyy-mm-dd (bộ lọc date_range). */
  from?: string;
  to?: string;
}

interface EditorState {
  filterValues: Record<string, FilterValue>;
  setFilterValue: (id: string, v: FilterValue | null) => void;
  crossFilters: CrossFilter[];
  toggleCrossFilter: (column: string, value: string, originId: string, multi: boolean) => void;
  clearCrossFilters: () => void;
  doc: Dashboard;
  selection: string[];
  mode: "edit" | "preview";
  past: Dashboard[];
  future: Dashboard[];
  view: View;
  viewport: { w: number; h: number };
  clipboard: Widget[];
  /** Widget nguồn để dán thông số (kích thước, vị trí, kiểu dáng). Khác `clipboard`: không tạo widget mới. */
  formatClips: Partial<Record<FormatPart, Widget>>;

  /** Trang đang xem/sửa (trạng thái giao diện, không lưu vào dashboard). Luôn đọc qua `resolvePageId`. */
  pageId: string;
  /** Hướng chuyển trang gần nhất (1 = tới, -1 = lui), để chọn hiệu ứng trượt. */
  pageDir: 1 | -1;
  setPage: (id: string) => void;
  /** Thêm trang mới ở cuối và chuyển sang đó. Trả id, hoặc null nếu đã đủ số trang tối đa. */
  addPage: () => string | null;
  renamePage: (id: string, name: string) => void;
  /** Xoá trang và mọi widget trên đó. Không xoá trang cuối cùng. */
  deletePage: (id: string) => boolean;
  duplicatePage: (id: string) => string | null;
  movePage: (id: string, dir: -1 | 1) => void;
  patchPage: (id: string, patch: Partial<Omit<Page, "id">>, key?: string) => void;
  patchNav: (patch: Partial<PageNav>, key?: string) => void;

  // nội bộ
  gestureBase: Dashboard | null;
  lastKey: string | null;
  lastTime: number;

  loadDoc: (doc: Dashboard) => void;
  setMode: (m: "edit" | "preview") => void;
  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;

  /** Thay đổi có ghi lịch sử. Cùng `key` liên tiếp trong 1s được gộp thành 1 bước undo. */
  mutate: (fn: (d: Dashboard) => Dashboard, key?: string) => void;
  patchWidget: (id: string, patch: Partial<Widget> | ((w: Widget) => Widget), key?: string) => void;

  /** Cử chỉ kéo/resize/xoay: thay đổi tức thời, chỉ ghi lịch sử 1 lần khi kết thúc. */
  beginGesture: () => void;
  applyLive: (fn: (d: Dashboard) => Dashboard) => void;
  endGesture: () => void;

  addWidget: (w: Widget) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  copy: () => void;
  /** Nhớ MỘT phần thông số (kích thước, vị trí hoặc kiểu dáng) của widget `id` (mặc định widget đầu tiên đang chọn). Ba phần nhớ riêng. */
  copyFormat: (part: FormatPart, id?: string) => void;
  /** Dán phần thông số đã nhớ lên mọi widget đang chọn (trừ widget khoá), gộp thành một bước undo. */
  pasteFormat: (part: FormatPart) => void;
  paste: () => void;
  reorder: (kind: OrderKind) => void;
  align: (kind: AlignKind) => void;
  nudge: (dx: number, dy: number) => void;
  undo: () => void;
  redo: () => void;

  setView: (v: Partial<View>) => void;
  setViewport: (w: number, h: number) => void;
  zoomAt: (cx: number, cy: number, factor: number) => void;
  /** Vừa khung nhìn; pad = lề (px). Toàn màn hình dùng pad = 0. */
  fit: (pad?: number) => void;
}

const newPageId = () => `pg_${Math.random().toString(36).slice(2, 8)}`;

const sortedByZ = (ws: Widget[]) =>
  ws.map((w, i) => ({ w, i })).sort((a, b) => a.w.z - b.w.z || a.i - b.i).map((e) => e.w);

/** Gán lại z = 0..n-1 theo thứ tự hiện tại để thứ tự lớp luôn liên tục. */
const normalizeZ = (ws: Widget[]): Widget[] => {
  const order = sortedByZ(ws);
  const zOf = new Map(order.map((w, i) => [w.id, i]));
  return ws.map((w) => (w.z === zOf.get(w.id) ? w : { ...w, z: zOf.get(w.id)! }));
};

export const useEditor = create<EditorState>((set, get) => ({
  doc: { schemaVersion: 1, id: "", name: "", canvas: { width: 1440, height: 900, background: "#fff" },
    theme: { palette: [], mode: "light" }, sources: [], filters: [], calculatedFields: [], pages: [], nav: DEFAULT_NAV, widgets: [] },
  pageId: DEFAULT_PAGE_ID,
  pageDir: 1,
  selection: [],
  crossFilters: [],
  filterValues: {},
  setFilterValue: (id, v) =>
    set((s) => {
      const next = { ...s.filterValues };
      if (v === null) delete next[id];
      else next[id] = v;
      return { filterValues: next };
    }),
  toggleCrossFilter: (column, value, originId, multi) =>
    set((s) => {
      const cur = s.crossFilters.find((f) => f.column === column);
      let next: CrossFilter | null;
      if (!cur) next = { column, values: [value], originId };
      else if (cur.values.includes(value)) {
        const values = cur.values.filter((v) => v !== value);
        next = values.length ? { ...cur, values } : null;
      } else next = { column, values: multi ? [...cur.values, value] : [value], originId };
      const rest = s.crossFilters.filter((f) => f.column !== column);
      return { crossFilters: next ? [...rest, next] : rest };
    }),
  clearCrossFilters: () => set((s) => (s.crossFilters.length ? { crossFilters: [] } : s)),
  mode: "edit",
  past: [],
  future: [],
  view: { zoom: 1, x: 40, y: 40 },
  viewport: { w: 0, h: 0 },
  clipboard: [],
  formatClips: {},
  gestureBase: null,
  lastKey: null,
  lastTime: 0,

  loadDoc: (doc) =>
    set({ doc, pageId: getPages(doc)[0].id, pageDir: 1, selection: [], crossFilters: [], filterValues: {}, past: [], future: [], gestureBase: null, lastKey: null }),
  setMode: (mode) => set({ mode, crossFilters: [], selection: mode === "preview" ? [] : get().selection }),
  select: (ids) => set({ selection: ids }),
  toggleSelect: (id) =>
    set((s) => ({
      selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id],
    })),

  mutate: (fn, key) =>
    set((s) => {
      const next = fn(s.doc);
      if (next === s.doc) return s;
      const now = Date.now();
      const coalesce = key !== undefined && key === s.lastKey && now - s.lastTime < 1000;
      return {
        doc: next,
        past: coalesce ? s.past : [...s.past, s.doc].slice(-HISTORY_LIMIT),
        future: [],
        lastKey: key ?? null,
        lastTime: now,
      };
    }),

  patchWidget: (id, patch, key) =>
    get().mutate(
      (d) => ({
        ...d,
        widgets: d.widgets.map((w) =>
          w.id === id ? (typeof patch === "function" ? patch(w) : { ...w, ...patch }) : w,
        ),
      }),
      key ? `${key}:${id}` : undefined,
    ),

  beginGesture: () => set((s) => ({ gestureBase: s.doc })),
  applyLive: (fn) => set((s) => ({ doc: fn(s.doc) })),
  endGesture: () =>
    set((s) => {
      if (!s.gestureBase) return s;
      if (s.gestureBase === s.doc) return { gestureBase: null };
      return {
        gestureBase: null,
        past: [...s.past, s.gestureBase].slice(-HISTORY_LIMIT),
        future: [],
        lastKey: null,
      };
    }),

  addWidget: (w) => {
    get().mutate((d) => {
      const z = d.widgets.reduce((m, x) => Math.max(m, x.z), -1) + 1;
      return { ...d, widgets: [...d.widgets, { ...w, z, pageId: resolvePageId(d, get().pageId) }] };
    });
    set({ selection: [w.id] });
  },

  removeSelected: () => {
    const ids = new Set(get().selection);
    if (ids.size === 0) return;
    get().mutate((d) => ({ ...d, widgets: normalizeZ(d.widgets.filter((w) => !ids.has(w.id) || w.locked)) }));
    set({ selection: [] });
  },

  duplicateSelected: () => {
    const { doc, selection } = get();
    const src = doc.widgets.filter((w) => selection.includes(w.id));
    if (src.length === 0) return;
    const copies = src.map((w) => ({ ...w, id: newId(), x: w.x + 24, y: w.y + 24, locked: false }));
    get().mutate((d) => {
      const base = d.widgets.reduce((m, x) => Math.max(m, x.z), -1) + 1;
      return { ...d, widgets: [...d.widgets, ...copies.map((c, i) => ({ ...c, z: base + i }))] };
    });
    set({ selection: copies.map((c) => c.id) });
  },

  copy: () => {
    const { doc, selection } = get();
    set({ clipboard: doc.widgets.filter((w) => selection.includes(w.id)) });
  },

  copyFormat: (part, id) => {
    const { doc, selection, formatClips } = get();
    const src = doc.widgets.find((w) => w.id === (id ?? selection[0]));
    if (src) set({ formatClips: { ...formatClips, [part]: src } });
  },

  pasteFormat: (part) => {
    const src = get().formatClips[part];
    const { selection } = get();
    if (!src) return;
    get().mutate((d) => {
      let changed = false;
      const widgets = d.widgets.map((w) => {
        if (!selection.includes(w.id)) return w;
        const next = applyFormat(w, src, [part]);
        if (next !== w) changed = true;
        return next;
      });
      return changed ? { ...d, widgets } : d;
    });
  },

  paste: () => {
    const { clipboard } = get();
    if (clipboard.length === 0) return;
    const target = resolvePageId(get().doc, get().pageId);
    const copies = clipboard.map((w) => ({ ...w, id: newId(), pageId: target, x: w.x + 24, y: w.y + 24, locked: false }));
    get().mutate((d) => {
      const base = d.widgets.reduce((m, x) => Math.max(m, x.z), -1) + 1;
      return { ...d, widgets: [...d.widgets, ...copies.map((c, i) => ({ ...c, z: base + i }))] };
    });
    // lần dán kế tiếp lệch thêm một nấc
    set({ selection: copies.map((c) => c.id), clipboard: copies });
  },

  reorder: (kind) => {
    const sel = new Set(get().selection);
    if (sel.size === 0) return;
    get().mutate((d) => {
      // Chỉ xếp lại các widget cùng trang: widget ở trang khác không liên quan tới thứ tự lớp ở đây.
      const order = sortedByZ(widgetsOnPage(d, get().pageId)).map((w) => w.id);
      const picked = order.filter((id) => sel.has(id));
      const rest = order.filter((id) => !sel.has(id));
      let next: string[];
      if (kind === "front") next = [...rest, ...picked];
      else if (kind === "back") next = [...picked, ...rest];
      else {
        next = [...order];
        const dir = kind === "forward" ? 1 : -1;
        const idxs = (dir === 1 ? [...picked].reverse() : picked).map((id) => next.indexOf(id));
        for (const i of idxs) {
          const j = i + dir;
          if (j < 0 || j >= next.length || sel.has(next[j])) continue;
          [next[i], next[j]] = [next[j], next[i]];
        }
      }
      const zOf = new Map(next.map((id, i) => [id, i]));
      return { ...d, widgets: d.widgets.map((w) => (zOf.has(w.id) ? { ...w, z: zOf.get(w.id)! } : w)) };
    });
  },

  align: (kind) => {
    const { doc, selection } = get();
    const items = doc.widgets.filter((w) => selection.includes(w.id) && !w.locked);
    if (items.length === 0) return;
    // 1 widget: căn theo artboard; nhiều widget: căn theo khung bao của cả nhóm.
    const bounds =
      items.length === 1
        ? { x: 0, y: 0, w: doc.canvas.width, h: doc.canvas.height }
        : union(items.map(aabb));
    get().mutate((d) => ({
      ...d,
      widgets: d.widgets.map((w) => {
        if (!items.includes(w)) return w;
        const b = aabb(w);
        let dx = 0;
        let dy = 0;
        if (kind === "left") dx = bounds.x - b.x;
        if (kind === "centerX") dx = bounds.x + bounds.w / 2 - (b.x + b.w / 2);
        if (kind === "right") dx = bounds.x + bounds.w - (b.x + b.w);
        if (kind === "top") dy = bounds.y - b.y;
        if (kind === "centerY") dy = bounds.y + bounds.h / 2 - (b.y + b.h / 2);
        if (kind === "bottom") dy = bounds.y + bounds.h - (b.y + b.h);
        return { ...w, x: Math.round(w.x + dx), y: Math.round(w.y + dy) };
      }),
    }));
  },

  nudge: (dx, dy) => {
    const sel = new Set(get().selection);
    if (sel.size === 0) return;
    get().mutate(
      (d) => ({
        ...d,
        widgets: d.widgets.map((w) => (sel.has(w.id) && !w.locked ? { ...w, x: w.x + dx, y: w.y + dy } : w)),
      }),
      "nudge",
    );
  },

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      const ids = new Set(prev.widgets.map((w) => w.id));
      return {
        doc: prev,
        past: s.past.slice(0, -1),
        future: [...s.future, s.doc],
        selection: s.selection.filter((id) => ids.has(id)),
        lastKey: null,
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[s.future.length - 1];
      const ids = new Set(next.widgets.map((w) => w.id));
      return {
        doc: next,
        future: s.future.slice(0, -1),
        past: [...s.past, s.doc],
        selection: s.selection.filter((id) => ids.has(id)),
        lastKey: null,
      };
    }),

  setPage: (id) =>
    set((s) => {
      const pages = getPages(s.doc);
      const to = pages.findIndex((p) => p.id === id);
      if (to < 0) return s;
      const from = pages.findIndex((p) => p.id === resolvePageId(s.doc, s.pageId));
      if (from === to) return s;
      return { pageId: id, pageDir: to > from ? 1 : -1, selection: [] };
    }),

  addPage: () => {
    if (getPages(get().doc).length >= MAX_PAGES) return null;
    const id = newPageId();
    get().mutate((d) => {
      const pages = getPages(d);
      // Lần đầu có hơn một trang: ghi rõ trang mặc định và gán trang cho widget cũ, để sau này xoá/đổi chỗ trang không làm chúng "trôi" sang trang khác.
      const widgets = d.pages.length ? d.widgets : d.widgets.map((w) => (w.pageId ? w : { ...w, pageId: DEFAULT_PAGE_ID }));
      return { ...d, pages: [...pages, { id, name: `Trang ${pages.length + 1}` }], widgets };
    });
    set({ pageId: id, pageDir: 1, selection: [] });
    return id;
  },

  renamePage: (id, name) => {
    const clean = name.trim().slice(0, 80);
    if (!clean) return;
    get().mutate(
      (d) => ({ ...d, pages: getPages(d).map((p) => (p.id === id ? { ...p, name: clean } : p)) }),
      `page-name:${id}`,
    );
  },

  deletePage: (id) => {
    const { doc } = get();
    const pages = getPages(doc);
    if (pages.length <= 1 || !pages.some((p) => p.id === id)) return false;
    const idx = pages.findIndex((p) => p.id === id);
    get().mutate((d) => ({
      ...d,
      pages: getPages(d).filter((p) => p.id !== id),
      widgets: normalizeZ(d.widgets.filter((w) => pageIdOf(d, w) !== id)),
    }));
    const left = pages.filter((p) => p.id !== id);
    set({ pageId: left[Math.max(0, idx - 1)].id, pageDir: -1, selection: [] });
    return true;
  },

  duplicatePage: (id) => {
    const { doc } = get();
    const pages = getPages(doc);
    const src = pages.find((p) => p.id === id);
    if (!src || pages.length >= MAX_PAGES) return null;
    const copyId = newPageId();
    get().mutate((d) => {
      const all = getPages(d);
      const at = all.findIndex((p) => p.id === id);
      const widgets = d.pages.length ? d.widgets : d.widgets.map((w) => (w.pageId ? w : { ...w, pageId: DEFAULT_PAGE_ID }));
      const copies = widgets
        .filter((w) => pageIdOf(d, w) === id)
        .map((w) => ({ ...w, id: newId(), pageId: copyId, locked: false }));
      const next = [...all];
      next.splice(at + 1, 0, { ...src, id: copyId, name: `${src.name} (bản sao)`.slice(0, 80) });
      return { ...d, pages: next, widgets: [...widgets, ...copies] };
    });
    set({ pageId: copyId, pageDir: 1, selection: [] });
    return copyId;
  },

  movePage: (id, dir) =>
    get().mutate((d) => {
      const pages = [...getPages(d)];
      const i = pages.findIndex((p) => p.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= pages.length) return d;
      [pages[i], pages[j]] = [pages[j], pages[i]];
      // Giữ nguyên trang mặc định ngầm định: nếu chưa có pages thì ghi rõ trước khi đổi chỗ.
      const widgets = d.pages.length ? d.widgets : d.widgets.map((w) => (w.pageId ? w : { ...w, pageId: DEFAULT_PAGE_ID }));
      return { ...d, pages, widgets };
    }),

  patchPage: (id, patch, key) =>
    get().mutate(
      (d) => ({ ...d, pages: getPages(d).map((p) => (p.id === id ? { ...p, ...patch } : p)) }),
      key ? `${key}:${id}` : undefined,
    ),

  patchNav: (patch, key) => get().mutate((d) => ({ ...d, nav: { ...d.nav, ...patch } }), key),

  setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
  setViewport: (w, h) => set({ viewport: { w, h } }),

  zoomAt: (cx, cy, factor) =>
    set((s) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s.view.zoom * factor));
      const k = zoom / s.view.zoom;
      return { view: { zoom, x: cx - (cx - s.view.x) * k, y: cy - (cy - s.view.y) * k } };
    }),

  fit: (pad = 56) =>
    set((s) => {
      const { w, h } = s.viewport;
      if (w === 0 || h === 0) return s;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM,
        Math.min((w - pad * 2) / s.doc.canvas.width, (h - pad * 2) / s.doc.canvas.height)));
      return {
        view: {
          zoom,
          x: (w - s.doc.canvas.width * zoom) / 2,
          y: Math.max(pad / 2, (h - s.doc.canvas.height * zoom) / 2),
        },
      };
    }),
}));
