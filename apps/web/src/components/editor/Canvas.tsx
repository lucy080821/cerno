"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Widget } from "@dashboard/schema";
import type { ChartTheme } from "@dashboard/chart-engine";
import { getPages, resolvePageId, widgetsOnPage } from "@dashboard/schema";
import { useEditor } from "@/lib/editor/store";
import {
  aabb, bestDelta, collectLines, guidesFor, HANDLES, intersects, normalizeAngle,
  resizeGeometry, snapMove, union,
  type Geom, type Guide, type HandleDir, type Pt, type Rect, type SnapLines,
} from "@/lib/editor/geometry";
import { frameStyle, WidgetContent } from "./WidgetContent";
import { SelectionOverlay } from "./SelectionOverlay";
import { WidgetContextMenu } from "./WidgetContextMenu";
import s from "./editor.module.css";

type Gesture =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | {
      kind: "move"; start: Pt; origin: Map<string, Pt>; startRect: Rect; lines: SnapLines;
      moved: boolean; clickedId: string; modifier: boolean;
    }
  | { kind: "resize"; id: string; dir: HandleDir; start: Geom; startPt: Pt; lines: SnapLines }
  | { kind: "rotate"; id: string; center: Pt; a0: number; startRot: number }
  | { kind: "marquee"; start: Pt; base: string[] };

const isTypingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

const WidgetBox = memo(function WidgetBox({
  widget, theme, edit, zIndex,
}: { widget: Widget; theme: ChartTheme; edit: boolean; zIndex: number }) {
  return (
    <div
      data-widget-id={widget.id}
      data-locked={widget.locked || undefined}
      className={edit ? s.widgetEdit : s.widget}
      style={{
        left: widget.x, top: widget.y, width: widget.w, height: widget.h, zIndex,
        transform: widget.rotation ? `rotate(${widget.rotation}deg)` : undefined,
      }}
    >
      <div className={s.widgetInner} style={frameStyle(widget, theme)}>
        <WidgetContent widget={widget} theme={theme} />
      </div>
    </div>
  );
});

export function Canvas({ wheel = "pan" }: { wheel?: "pan" | "page" } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const spaceRef = useRef(false);
  const fitted = useRef(false);

  const doc = useEditor((st) => st.doc);
  const mode = useEditor((st) => st.mode);
  const view = useEditor((st) => st.view);
  const viewportW = useEditor((st) => st.viewport.w);

  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);

  const { palette, mode: themeMode, fontFamily } = doc.theme;
  const theme = useMemo<ChartTheme>(() => ({ palette, mode: themeMode, fontFamily }), [palette, themeMode, fontFamily]);
  const pageId = useEditor((st) => resolvePageId(st.doc, st.pageId));
  const pageWidgets = useMemo(() => widgetsOnPage(doc, pageId), [doc, pageId]);
  const pageBg = useMemo(() => getPages(doc).find((p) => p.id === pageId)?.background, [doc, pageId]);
  const ordered = useMemo(() => [...pageWidgets].sort((a, b) => a.z - b.z), [pageWidgets]);

  // --- kích thước vùng nhìn + tự fit lần đầu ---------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = () => useEditor.getState().setViewport(el.clientWidth, el.clientHeight);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (viewportW > 0 && !fitted.current) {
      fitted.current = true;
      useEditor.getState().fit();
    }
  }, [viewportW]);

  // --- phím cách để kéo canvas ---------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTypingTarget(e.target)) {
        e.preventDefault();
        spaceRef.current = true;
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        setSpaceDown(false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // --- cuộn chuột: Ctrl/⌘ + cuộn (hoặc pinch) = zoom, còn lại = pan -------------
  useEffect(() => {
    const el = containerRef.current;
    // "page": canvas nằm giữa một trang dài (trang giới thiệu), cuộn chuột phải cuộn trang, không bắt sự kiện.
    if (!el || wheel === "page") return;
    const onWheel = (e: WheelEvent) => {
      const st = useEditor.getState();
      // Khi xem trước: cuộn chuột trên bảng còn chỗ để cuộn thì cuộn bảng, không pan canvas.
      if (!e.ctrlKey && !e.metaKey) {
        const box = (e.target as HTMLElement | null)?.closest?.("[data-scrollable]") as HTMLElement | null;
        const wid = box?.closest<HTMLElement>("[data-widget-id]")?.dataset.widgetId;
        const active = st.mode === "preview" || (!!wid && st.selection.length === 1 && st.selection[0] === wid);
        if (box && active) {
          const canY = e.deltaY < 0 ? box.scrollTop > 0 : box.scrollTop + box.clientHeight < box.scrollHeight - 1;
          const canX = e.deltaX < 0 ? box.scrollLeft > 0 : box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
          if ((e.deltaY !== 0 && canY) || (e.deltaX !== 0 && canX)) return;
        }
      }
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        st.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
      } else {
        st.setView({ x: st.view.x - e.deltaX, y: st.view.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [wheel]);

  const toWorld = (clientX: number, clientY: number): Pt => {
    const r = containerRef.current!.getBoundingClientRect();
    const v = useEditor.getState().view;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  };

  const linesFor = (excludeIds: Set<string>): SnapLines => {
    const d = useEditor.getState().doc;
    const others = widgetsOnPage(d, useEditor.getState().pageId).filter((w) => !excludeIds.has(w.id) && !w.hidden).map(aabb);
    return collectLines(others, { w: d.canvas.width, h: d.canvas.height });
  };

  // --- bắt đầu cử chỉ ------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = useEditor.getState();
    const el = containerRef.current!;

    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: st.view.x, vy: st.view.y };
      setPanning(true);
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0 || st.mode === "preview") return;

    const target = e.target as HTMLElement;
    // Bảng đang được chọn: để bấm tiêu đề (sắp xếp) và kéo thanh cuộn hoạt động, không bắt cử chỉ kéo widget.
    const tableEl = target.closest<HTMLElement>("[data-scrollable]");
    if (tableEl && !(e.shiftKey || e.metaKey || e.ctrlKey)) {
      const wid = tableEl.closest<HTMLElement>("[data-widget-id]")?.dataset.widgetId;
      if (wid && st.selection.length === 1 && st.selection[0] === wid) return;
    }
    const p = toWorld(e.clientX, e.clientY);
    el.setPointerCapture(e.pointerId);

    // 1) handle resize / xoay
    const handleEl = target.closest<HTMLElement>("[data-handle]");
    if (handleEl) {
      const w = st.doc.widgets.find((x) => x.id === handleEl.dataset.owner);
      if (!w) return;
      st.beginGesture();
      if (handleEl.dataset.handle === "rotate") {
        const center = { x: w.x + w.w / 2, y: w.y + w.h / 2 };
        gesture.current = {
          kind: "rotate", id: w.id, center, startRot: w.rotation,
          a0: (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI,
        };
      } else {
        gesture.current = {
          kind: "resize", id: w.id, dir: HANDLES[handleEl.dataset.handle!], startPt: p,
          start: { x: w.x, y: w.y, w: w.w, h: w.h, rotation: w.rotation },
          lines: linesFor(new Set([w.id])),
        };
      }
      return;
    }

    const modifier = e.shiftKey || e.metaKey || e.ctrlKey;

    // 2) bấm vào widget → chọn + chuẩn bị kéo
    const widgetEl = target.closest<HTMLElement>("[data-widget-id]");
    if (widgetEl) {
      const id = widgetEl.dataset.widgetId!;
      if (modifier) {
        st.toggleSelect(id);
        if (!useEditor.getState().selection.includes(id)) return;
      } else if (!st.selection.includes(id)) {
        st.select([id]);
      }
      const { doc: d, selection } = useEditor.getState();
      const movable = d.widgets.filter((w) => selection.includes(w.id) && !w.locked);
      if (movable.length === 0) return;
      const ids = new Set(movable.map((w) => w.id));
      st.beginGesture();
      gesture.current = {
        kind: "move", start: p, clickedId: id, modifier, moved: false,
        origin: new Map(movable.map((w) => [w.id, { x: w.x, y: w.y }])),
        startRect: union(movable.map(aabb)),
        lines: linesFor(ids),
      };
      return;
    }

    // 3) bấm vào chỗ trống → khoanh vùng chọn
    if (!modifier) st.select([]);
    gesture.current = { kind: "marquee", start: p, base: modifier ? st.selection : [] };
  };

  // --- đang kéo --------------------------------------------------------------
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const st = useEditor.getState();
    const zoom = st.view.zoom;

    if (g.kind === "pan") {
      st.setView({ x: g.vx + (e.clientX - g.sx), y: g.vy + (e.clientY - g.sy) });
      return;
    }

    const p = toWorld(e.clientX, e.clientY);

    if (g.kind === "move") {
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * zoom < 3) return;
      g.moved = true;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      let rect: Rect = { ...g.startRect, x: g.startRect.x + dx, y: g.startRect.y + dy };
      if (!e.altKey) {
        const sn = snapMove(rect, g.lines, 6 / zoom);
        dx += sn.dx;
        dy += sn.dy;
        rect = { ...g.startRect, x: g.startRect.x + dx, y: g.startRect.y + dy };
        setGuides(guidesFor(rect, g.lines));
      } else setGuides([]);
      dx = Math.round(dx);
      dy = Math.round(dy);
      st.applyLive((d) => ({
        ...d,
        widgets: d.widgets.map((w) => {
          const o = g.origin.get(w.id);
          return o ? { ...w, x: o.x + dx, y: o.y + dy } : w;
        }),
      }));
      return;
    }

    if (g.kind === "resize") {
      let dx = p.x - g.startPt.x;
      let dy = p.y - g.startPt.y;
      const axisAligned = normalizeAngle(g.start.rotation) === 0;
      if (axisAligned && !e.altKey) {
        const th = 6 / zoom;
        if (g.dir.hx !== 0) {
          const edge = g.dir.hx === 1 ? g.start.x + g.start.w + dx : g.start.x + dx;
          dx += bestDelta([edge], g.lines.xs, th) ?? 0;
        }
        if (g.dir.hy !== 0) {
          const edge = g.dir.hy === 1 ? g.start.y + g.start.h + dy : g.start.y + dy;
          dy += bestDelta([edge], g.lines.ys, th) ?? 0;
        }
      }
      const r = resizeGeometry(g.start, g.dir, dx, dy, {
        keepAspect: e.shiftKey && g.dir.hx !== 0 && g.dir.hy !== 0,
      });
      setGuides(axisAligned && !e.altKey ? guidesFor(r, g.lines) : []);
      const next = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
      st.applyLive((d) => ({ ...d, widgets: d.widgets.map((w) => (w.id === g.id ? { ...w, ...next } : w)) }));
      return;
    }

    if (g.kind === "rotate") {
      const a = (Math.atan2(p.y - g.center.y, p.x - g.center.x) * 180) / Math.PI;
      let rot = g.startRot + (a - g.a0);
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      rot = normalizeAngle(Math.round(rot * 10) / 10);
      for (const k of [0, 90, -90, 180, -180]) if (Math.abs(rot - k) < 3) rot = k === -180 ? 180 : k;
      st.applyLive((d) => ({ ...d, widgets: d.widgets.map((w) => (w.id === g.id ? { ...w, rotation: rot } : w)) }));
      return;
    }

    if (g.kind === "marquee") {
      const rect: Rect = {
        x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y),
        w: Math.abs(p.x - g.start.x), h: Math.abs(p.y - g.start.y),
      };
      setMarquee(rect);
      const hit = widgetsOnPage(st.doc, st.pageId).filter((w) => !w.hidden && intersects(rect, aabb(w))).map((w) => w.id);
      st.select([...new Set([...g.base, ...hit])]);
    }
  };

  // --- kết thúc --------------------------------------------------------------
  const finish = () => {
    const g = gesture.current;
    gesture.current = null;
    const st = useEditor.getState();
    if (g && (g.kind === "move" || g.kind === "resize" || g.kind === "rotate")) st.endGesture();
    // bấm (không kéo) vào một widget trong nhóm đang chọn → chỉ chọn widget đó
    if (g?.kind === "move" && !g.moved && !g.modifier && st.selection.length > 1) st.select([g.clickedId]);
    setGuides([]);
    setMarquee(null);
    setPanning(false);
  };

  const edit = mode === "edit";
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!edit) return;
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-widget-id]")?.dataset.widgetId;
    e.preventDefault();
    if (!id) {
      setMenu(null);
      return;
    }
    const st = useEditor.getState();
    if (!st.selection.includes(id)) st.select([id]);
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const cursor = panning ? "grabbing" : spaceDown ? "grab" : undefined;

  return (
    <div
      ref={containerRef}
      className={s.viewport}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onContextMenu={onContextMenu}
    >
      {menu && <WidgetContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
      <div className={s.world} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <div
          className={s.artboard}
          data-artboard
          style={{ width: doc.canvas.width, height: doc.canvas.height, background: pageBg ?? doc.canvas.background }}
        >
          {ordered.map((w, i) => (w.hidden ? null : <WidgetBox key={w.id} widget={w} theme={theme} edit={edit} zIndex={i + 1} />))}

          {edit && (
            <div className={s.overlay}>
              <SelectionOverlay />
              {guides.map((g, i) => (
                <div
                  key={i}
                  className={s.guide}
                  style={
                    g.orientation === "v"
                      ? { left: g.pos - 0.5 / view.zoom, top: g.from, width: 1 / view.zoom, height: g.to - g.from }
                      : { top: g.pos - 0.5 / view.zoom, left: g.from, height: 1 / view.zoom, width: g.to - g.from }
                  }
                />
              ))}
              {marquee && (
                <div
                  className={s.marquee}
                  style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: 1 / view.zoom }}
                />
              )}
            </div>
          )}

          {pageWidgets.length === 0 && edit && (
            <div className={s.emptyHint}>Trang trống. Thêm biểu đồ từ bảng bên trái.</div>
          )}
        </div>
      </div>
    </div>
  );
}
