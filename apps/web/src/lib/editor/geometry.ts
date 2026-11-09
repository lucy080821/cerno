/**
 * Hình học cho canvas đặt tự do. Mọi hàm là hàm thuần (không đụng DOM) để dễ test.
 * Widget lưu (x, y, w, h) là góc trên-trái của hình chữ nhật CHƯA xoay;
 * rotation (độ) xoay quanh tâm của nó.
 */

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Geom extends Rect {
  rotation: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** 4 góc của widget sau khi xoay: trên-trái, trên-phải, dưới-phải, dưới-trái. */
export function corners(g: Geom): Pt[] {
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  const cos = Math.cos(rad(g.rotation));
  const sin = Math.sin(rad(g.rotation));
  return (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
  ).map(([sx, sy]) => {
    const lx = (sx * g.w) / 2;
    const ly = (sy * g.h) / 2;
    return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
  });
}

/** Hình chữ nhật bao (axis-aligned) của widget đã xoay. */
export function aabb(g: Geom): Rect {
  const cs = corners(g);
  const xs = cs.map((c) => c.x);
  const ys = cs.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function union(rects: Rect[]): Rect {
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normalizeAngle(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return a;
}

// ---------------------------------------------------------------------------
// Snap (đường gióng)
// ---------------------------------------------------------------------------

export interface SnapLine {
  pos: number;
  /** Widget tạo ra đường này; null = đường của artboard. */
  rect: Rect | null;
}
export interface SnapLines {
  xs: SnapLine[];
  ys: SnapLine[];
  canvas: { w: number; h: number };
}
export interface Guide {
  orientation: "v" | "h";
  pos: number;
  from: number;
  to: number;
}

/** Các đường mà widget đang kéo có thể hút vào: mép + tâm của artboard và của các widget khác. */
export function collectLines(targets: Rect[], canvas: { w: number; h: number }): SnapLines {
  const xs: SnapLine[] = [
    { pos: 0, rect: null },
    { pos: canvas.w / 2, rect: null },
    { pos: canvas.w, rect: null },
  ];
  const ys: SnapLine[] = [
    { pos: 0, rect: null },
    { pos: canvas.h / 2, rect: null },
    { pos: canvas.h, rect: null },
  ];
  for (const r of targets) {
    xs.push({ pos: r.x, rect: r }, { pos: r.x + r.w / 2, rect: r }, { pos: r.x + r.w, rect: r });
    ys.push({ pos: r.y, rect: r }, { pos: r.y + r.h / 2, rect: r }, { pos: r.y + r.h, rect: r });
  }
  return { xs, ys, canvas };
}

/** Độ lệch nhỏ nhất (trong ngưỡng) để một trong các `values` chạm vào một `line`. */
export function bestDelta(values: number[], lines: SnapLine[], threshold: number): number | null {
  let best: number | null = null;
  for (const v of values) {
    for (const l of lines) {
      const d = l.pos - v;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

export function snapMove(r: Rect, lines: SnapLines, threshold: number): { dx: number; dy: number } {
  return {
    dx: bestDelta([r.x, r.x + r.w / 2, r.x + r.w], lines.xs, threshold) ?? 0,
    dy: bestDelta([r.y, r.y + r.h / 2, r.y + r.h], lines.ys, threshold) ?? 0,
  };
}

/** Các đường gióng cần vẽ cho hình chữ nhật `r` sau khi đã snap. */
export function guidesFor(r: Rect, lines: SnapLines, eps = 0.75): Guide[] {
  const merged = new Map<string, Guide>();
  const add = (g: Guide) => {
    const key = `${g.orientation}:${Math.round(g.pos * 2)}`;
    const prev = merged.get(key);
    if (prev) {
      prev.from = Math.min(prev.from, g.from);
      prev.to = Math.max(prev.to, g.to);
    } else merged.set(key, g);
  };
  for (const v of [r.x, r.x + r.w / 2, r.x + r.w]) {
    for (const l of lines.xs) {
      if (Math.abs(l.pos - v) > eps) continue;
      add({
        orientation: "v",
        pos: l.pos,
        from: Math.min(r.y, l.rect ? l.rect.y : 0),
        to: Math.max(r.y + r.h, l.rect ? l.rect.y + l.rect.h : lines.canvas.h),
      });
    }
  }
  for (const v of [r.y, r.y + r.h / 2, r.y + r.h]) {
    for (const l of lines.ys) {
      if (Math.abs(l.pos - v) > eps) continue;
      add({
        orientation: "h",
        pos: l.pos,
        from: Math.min(r.x, l.rect ? l.rect.x : 0),
        to: Math.max(r.x + r.w, l.rect ? l.rect.x + l.rect.w : lines.canvas.w),
      });
    }
  }
  return [...merged.values()];
}

// ---------------------------------------------------------------------------
// Đổi kích thước (đúng cả khi widget đang xoay)
// ---------------------------------------------------------------------------

/** Hướng của handle: -1 = mép trái/trên, 1 = mép phải/dưới, 0 = không đổi theo trục đó. */
export type HandleDir = { hx: -1 | 0 | 1; hy: -1 | 0 | 1 };

export const HANDLES: Record<string, HandleDir> = {
  nw: { hx: -1, hy: -1 },
  n: { hx: 0, hy: -1 },
  ne: { hx: 1, hy: -1 },
  e: { hx: 1, hy: 0 },
  se: { hx: 1, hy: 1 },
  s: { hx: 0, hy: 1 },
  sw: { hx: -1, hy: 1 },
  w: { hx: -1, hy: 0 },
};

/**
 * Kéo handle `dir` một đoạn (dx, dy) trong toạ độ thế giới. Điểm đối diện handle đứng yên
 * trong không gian thế giới, kể cả khi widget đã xoay.
 */
export function resizeGeometry(
  start: Geom,
  dir: HandleDir,
  dx: number,
  dy: number,
  opts: { keepAspect?: boolean; minSize?: number } = {},
): Rect {
  const min = opts.minSize ?? 24;
  const cos = Math.cos(rad(start.rotation));
  const sin = Math.sin(rad(start.rotation));
  const toWorld = (lx: number, ly: number): Pt => ({
    x: lx * cos - ly * sin,
    y: lx * sin + ly * cos,
  });
  // delta của con trỏ trong hệ toạ độ của widget (đã bỏ xoay)
  const ldx = dx * cos + dy * sin;
  const ldy = -dx * sin + dy * cos;

  let w = dir.hx !== 0 ? Math.max(min, start.w + dir.hx * ldx) : start.w;
  let h = dir.hy !== 0 ? Math.max(min, start.h + dir.hy * ldy) : start.h;

  if (opts.keepAspect && dir.hx !== 0 && dir.hy !== 0) {
    const s = Math.max(w / start.w, h / start.h);
    w = Math.max(min, start.w * s);
    h = Math.max(min, start.h * s);
  }

  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;
  const anchorOff = toWorld((-dir.hx * start.w) / 2, (-dir.hy * start.h) / 2);
  const newOff = toWorld((dir.hx * w) / 2, (dir.hy * h) / 2);
  const ncx = cx + anchorOff.x + newOff.x;
  const ncy = cy + anchorOff.y + newOff.y;
  return { x: ncx - w / 2, y: ncy - h / 2, w, h };
}

/** Con trỏ phù hợp với handle khi widget đang xoay. */
export function cursorFor(dir: HandleDir, rotation: number): string {
  const angle = (Math.atan2(dir.hy, dir.hx) * 180) / Math.PI + rotation;
  const sector = ((Math.round(angle / 45) % 4) + 4) % 4;
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][sector];
}
