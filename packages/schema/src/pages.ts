import { PageNav, type Dashboard, type Page, type Widget } from "./dashboard";

/** Kiểu mặc định của thanh điều hướng trang (tất cả trường lấy default của schema). */
export const DEFAULT_NAV: PageNav = PageNav.parse({});

/** Id của trang mặc định khi dashboard chưa khai báo trang nào. */
export const DEFAULT_PAGE_ID = "page-1";
export const MAX_PAGES = 20;

/** Danh sách trang thực tế: nếu dashboard chưa có trang nào thì là một trang mặc định ("Trang 1"). */
export function getPages(doc: Pick<Dashboard, "pages">): Page[] {
  return doc.pages.length ? doc.pages : [{ id: DEFAULT_PAGE_ID, name: "Trang 1" }];
}

/** Id trang hợp lệ: `id` nếu còn tồn tại, nếu không (đã xoá, undo...) thì trang đầu tiên. */
export function resolvePageId(doc: Pick<Dashboard, "pages">, id: string | undefined): string {
  const pages = getPages(doc);
  return id && pages.some((p) => p.id === id) ? id : pages[0].id;
}

/** Trang của một widget. Widget chưa gán trang hoặc gán trang không còn tồn tại thuộc trang đầu tiên. */
export function pageIdOf(doc: Pick<Dashboard, "pages">, widget: Pick<Widget, "pageId">): string {
  return resolvePageId(doc, widget.pageId);
}

export function widgetsOnPage(doc: Pick<Dashboard, "pages" | "widgets">, pageId: string): Widget[] {
  const target = resolvePageId(doc, pageId);
  return doc.widgets.filter((w) => pageIdOf(doc, w) === target);
}
