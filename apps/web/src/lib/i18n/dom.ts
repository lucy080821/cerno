import type { Translate } from "./translate";

/**
 * Dịch chữ hiển thị TRỰC TIẾP trên trang, không cần tải lại và không có trang riêng cho từng ngôn ngữ.
 * Duyệt text node + các thuộc tính chữ (placeholder, title, aria-label, alt), nhớ bản gốc tiếng Việt để đổi lại,
 * rồi theo dõi thay đổi của trang (React vẽ thêm/đổi chữ) để dịch tiếp. Chỉ ghi `data` của text node có sẵn
 * (không thêm/xoá node), nên không làm React lệch cây DOM.
 */
const ATTRS = ["placeholder", "title", "aria-label", "alt"] as const;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT", "CODE", "PRE"]);

interface Entry { orig: string; shown: string }

/** Thời gian tối đa (ms, tính từ lúc trang mở) chờ React hydrate xong một vùng trước khi dịch chữ trong đó. */
const HYDRATION_WAIT_MS = 6000;
const RECHECK_MS = 150;

/**
 * Phần tử đã được React "nhận" (hydrate) chưa. React gắn khoá `__reactFiber$…` lên mọi phần tử đã hydrate.
 * Dịch chữ của vùng CHƯA hydrate sẽ làm văn bản lệch với bản React dựng ở client → lỗi "Hydration failed".
 */
function isHydrated(el: Element | null, cache: WeakSet<Element>): boolean {
  if (!el) return true;
  if (cache.has(el)) return true;
  for (const k of Object.getOwnPropertyNames(el)) {
    if (k.startsWith("__reactFiber$")) {
      cache.add(el);
      return true;
    }
  }
  return false;
}

export class DomTranslator {
  private lang: "vi" | "en" = "vi";
  private texts = new WeakMap<Text, Entry>();
  private attrs = new WeakMap<Element, Map<string, Entry>>();
  private observer: MutationObserver | null = null;
  private readonly createdAt = Date.now();
  private hydrated = new WeakSet<Element>();
  /** Text node chờ vùng của nó hydrate xong mới dịch (các vùng nạp muộn: component động, Suspense). */
  private waiting = new Set<Text>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private root: Node, private translate: Translate) {}

  /**
   * Đổi ngôn ngữ và dịch lại toàn bộ trang. Chỉ theo dõi thay đổi của trang khi đang ở tiếng Anh: tiếng Việt là
   * chữ gốc nên không cần làm gì thêm (đỡ tốn công mỗi lần React vẽ lại).
   */
  setLang(lang: "vi" | "en") {
    this.lang = lang;
    this.waiting.clear();
    this.walk(this.root);
    if (lang === "en") this.observe();
    else this.stop();
  }

  private observe() {
    if (this.observer) return;
    this.observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "characterData") this.text(r.target as Text);
        else if (r.type === "attributes") this.attr(r.target as Element, r.attributeName!);
        else r.addedNodes.forEach((n) => this.walk(n));
      }
    });
    this.observer.observe(this.root, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS],
    });
  }

  stop() {
    this.observer?.disconnect();
    this.observer = null;
    this.waiting.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Còn trong thời gian chờ và vùng chứa node này chưa hydrate: để sau, kẻo làm lệch cây React. */
  private shouldWait(node: Text): boolean {
    if (Date.now() - this.createdAt > HYDRATION_WAIT_MS) return false;
    return !isHydrated(node.parentElement, this.hydrated);
  }

  private defer(node: Text) {
    this.waiting.add(node);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const batch = [...this.waiting];
      this.waiting.clear();
      for (const n of batch) if (n.isConnected) this.text(n);
    }, RECHECK_MS);
  }

  private skipped(el: Element | null): boolean {
    for (let e = el; e; e = e.parentElement) {
      if (SKIP_TAGS.has(e.tagName) || e.hasAttribute("data-i18n-skip") || (e as HTMLElement).isContentEditable) return true;
    }
    return false;
  }

  private walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) return this.text(node as Text);
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) return;
    if (node.nodeType === Node.ELEMENT_NODE && this.skipped(node as Element)) return;
    const doc = node.ownerDocument ?? (node as Document);
    const tw = doc.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    // Gồm cả chính phần tử gốc (thuộc tính của nó).
    if (node.nodeType === Node.ELEMENT_NODE) for (const a of ATTRS) this.attr(node as Element, a);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) this.text(n as Text);
      else {
        const el = n as Element;
        if (SKIP_TAGS.has(el.tagName) || el.hasAttribute("data-i18n-skip")) {
          // bỏ cả nhánh con
          let last: Node = el;
          while (last.lastChild) last = last.lastChild;
          tw.currentNode = last;
          continue;
        }
        for (const a of ATTRS) this.attr(el, a);
      }
    }
  }

  private apply(current: string, e: Entry | undefined): { next: string; entry: Entry | null } {
    // Chữ đã bị nơi khác (React) đổi sang giá trị mới → coi đó là bản gốc mới.
    const orig = e && current === e.shown ? e.orig : current;
    if (this.lang === "vi") return { next: orig, entry: null };
    const tr = this.translate(orig);
    if (tr === null || tr === orig) return { next: orig, entry: null };
    return { next: tr, entry: { orig, shown: tr } };
  }

  private text(node: Text) {
    if (this.skipped(node.parentElement)) return;
    const e = this.texts.get(node);
    if (this.lang === "en" && !e && this.shouldWait(node)) return this.defer(node);
    if (e && node.data === e.shown && this.lang === "en") return; // đã dịch, không đổi
    const { next, entry } = this.apply(node.data, e);
    if (entry) this.texts.set(node, entry);
    else this.texts.delete(node);
    if (node.data !== next) node.data = next;
  }

  private attr(el: Element, name: string) {
    const cur = el.getAttribute(name);
    if (cur === null) return;
    let map = this.attrs.get(el);
    const e = map?.get(name);
    if (e && cur === e.shown && this.lang === "en") return;
    const { next, entry } = this.apply(cur, e);
    if (entry) {
      if (!map) this.attrs.set(el, (map = new Map()));
      map.set(name, entry);
    } else map?.delete(name);
    if (cur !== next) el.setAttribute(name, next);
  }
}
