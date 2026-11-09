import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PAGE_ID, getPages, resolvePageId, widgetsOnPage } from "@dashboard/schema";
import { useEditor } from "./store";
import { createDemoDashboard, createWidget } from "./defaults";
import { applyAiActions } from "./ai-actions";

const st = () => useEditor.getState();
const cur = () => resolvePageId(st().doc, st().pageId);
const onPage = (id: string) => widgetsOnPage(st().doc, id);

beforeEach(() => {
  st().loadDoc(createDemoDashboard());
});

describe("nhiều trang: thêm / chuyển", () => {
  it("mặc định một trang ngầm định chứa mọi widget", () => {
    expect(getPages(st().doc)).toHaveLength(1);
    expect(cur()).toBe(DEFAULT_PAGE_ID);
    expect(onPage(DEFAULT_PAGE_ID)).toHaveLength(st().doc.widgets.length);
  });

  it("thêm trang: ghi rõ trang đầu cho widget cũ, chuyển sang trang mới, trang mới trống", () => {
    const before = st().doc.widgets.length;
    const id = st().addPage()!;
    expect(getPages(st().doc).map((p) => p.name)).toEqual(["Trang 1", "Trang 2"]);
    expect(cur()).toBe(id);
    expect(onPage(id)).toHaveLength(0);
    expect(onPage(DEFAULT_PAGE_ID)).toHaveLength(before);
    expect(st().doc.widgets.every((w) => w.pageId === DEFAULT_PAGE_ID)).toBe(true);
  });

  it("widget mới và widget dán thuộc trang đang xem", () => {
    const p2 = st().addPage()!;
    st().addWidget(createWidget("text", { x: 10, y: 10 }));
    expect(onPage(p2)).toHaveLength(1);
    st().copy(); // chưa chọn gì → clipboard rỗng; chọn rồi copy
    st().select(onPage(p2).map((w) => w.id));
    st().copy();
    st().setPage(DEFAULT_PAGE_ID);
    st().paste();
    expect(onPage(p2)).toHaveLength(1);
    expect(onPage(DEFAULT_PAGE_ID).some((w) => w.config.kind === "text" && w.x === 34)).toBe(true);
  });

  it("setPage đặt hướng chuyển và bỏ chọn", () => {
    const p2 = st().addPage()!;
    st().select(["x"]);
    st().setPage(DEFAULT_PAGE_ID);
    expect(st().pageDir).toBe(-1);
    expect(st().selection).toEqual([]);
    st().setPage(p2);
    expect(st().pageDir).toBe(1);
  });

  it("giới hạn 20 trang", () => {
    for (let i = 0; i < 25; i++) st().addPage();
    expect(getPages(st().doc)).toHaveLength(20);
    expect(st().addPage()).toBeNull();
  });
});

describe("nhiều trang: xoá / nhân đôi / đổi chỗ / đổi tên", () => {
  it("xoá trang xoá luôn widget của nó, không xoá trang cuối", () => {
    const total = st().doc.widgets.length;
    const p2 = st().addPage()!;
    st().addWidget(createWidget("text", { x: 0, y: 0 }));
    expect(st().deletePage(p2)).toBe(true);
    expect(getPages(st().doc)).toHaveLength(2 - 1);
    expect(st().doc.widgets).toHaveLength(total);
    expect(cur()).toBe(DEFAULT_PAGE_ID);
    expect(st().deletePage(DEFAULT_PAGE_ID)).toBe(false); // còn đúng một trang
  });

  it("xoá trang đầu: widget của trang đầu bị xoá, widget trang sau không trôi sang", () => {
    const p2 = st().addPage()!;
    st().addWidget(createWidget("text", { x: 0, y: 0 }));
    const keep = onPage(p2).map((w) => w.id);
    st().deletePage(DEFAULT_PAGE_ID);
    expect(getPages(st().doc).map((p) => p.id)).toEqual([p2]);
    expect(st().doc.widgets.map((w) => w.id)).toEqual(keep);
  });

  it("nhân đôi trang: widget sao chép có id mới và nằm ở trang mới", () => {
    const n = st().doc.widgets.length;
    const copyId = st().duplicatePage(DEFAULT_PAGE_ID)!;
    expect(getPages(st().doc).map((p) => p.name)).toEqual(["Trang 1", "Trang 1 (bản sao)"]);
    expect(onPage(copyId)).toHaveLength(n);
    expect(onPage(DEFAULT_PAGE_ID)).toHaveLength(n);
    const ids = st().doc.widgets.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cur()).toBe(copyId);
  });

  it("đổi chỗ trang giữ widget đúng trang của nó", () => {
    const p2 = st().addPage()!;
    st().addWidget(createWidget("text", { x: 0, y: 0 }));
    const w2 = onPage(p2).map((w) => w.id);
    st().movePage(p2, -1);
    expect(getPages(st().doc).map((p) => p.id)).toEqual([p2, DEFAULT_PAGE_ID]);
    expect(onPage(p2).map((w) => w.id)).toEqual(w2);
  });

  it("đổi tên: bỏ khoảng trắng thừa, bỏ qua tên rỗng", () => {
    st().renamePage(DEFAULT_PAGE_ID, "  Tổng quan  ");
    expect(getPages(st().doc)[0].name).toBe("Tổng quan");
    st().renamePage(DEFAULT_PAGE_ID, "   ");
    expect(getPages(st().doc)[0].name).toBe("Tổng quan");
  });

  it("hoàn tác thêm trang trả lại một trang, trang đang xem tự rơi về trang đầu", () => {
    st().addPage();
    st().undo();
    expect(getPages(st().doc)).toHaveLength(1);
    expect(cur()).toBe(DEFAULT_PAGE_ID);
  });
});

describe("thứ tự lớp và AI theo trang", () => {
  it("đổi thứ tự lớp chỉ ảnh hưởng widget cùng trang", () => {
    const p2 = st().addPage()!;
    st().addWidget(createWidget("text", { x: 0, y: 0 }));
    st().addWidget(createWidget("text", { x: 0, y: 60 }));
    const [a, b] = [...onPage(p2)].sort((x, y) => x.z - y.z).map((w) => w.id);
    const otherZ = new Map(onPage(DEFAULT_PAGE_ID).map((w) => [w.id, w.z]));
    st().select([a]);
    st().reorder("front");
    const after = [...onPage(p2)].sort((x, y) => x.z - y.z).map((w) => w.id);
    expect(after).toEqual([b, a]);
    onPage(DEFAULT_PAGE_ID).forEach((w) => expect(w.z).toBe(otherZ.get(w.id)));
  });

  it("AI thêm widget vào đúng trang được truyền, đặt dưới widget của trang đó", () => {
    const p2 = st().addPage()!;
    const r = applyAiActions(st().doc, [{ name: "add_widget", args: { kind: "text", text: "Xin chào" } }], p2);
    expect(r.results[0].ok).toBe(true);
    const added = widgetsOnPage(r.doc, p2);
    expect(added).toHaveLength(1);
    expect(added[0].y).toBe(24); // trang 2 trống nên bắt đầu từ trên cùng, không bị đẩy xuống theo trang 1
    expect(widgetsOnPage(r.doc, DEFAULT_PAGE_ID)).toHaveLength(st().doc.widgets.length); // trang 1 giữ nguyên
  });
});
