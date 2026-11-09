import { describe, expect, it } from "vitest";
import {
  aabb,
  collectLines,
  guidesFor,
  HANDLES,
  intersects,
  normalizeAngle,
  resizeGeometry,
  snapMove,
} from "./geometry";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("aabb", () => {
  it("không xoay thì bằng chính nó", () => {
    expect(aabb({ x: 10, y: 20, w: 100, h: 50, rotation: 0 })).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  it("xoay 90° đổi chỗ rộng/cao quanh tâm", () => {
    const b = aabb({ x: 0, y: 0, w: 100, h: 40, rotation: 90 });
    close(b.w, 40);
    close(b.h, 100);
    close(b.x, 30);
    close(b.y, -30);
  });
});

describe("snap", () => {
  const lines = collectLines([{ x: 300, y: 100, w: 200, h: 100 }], { w: 1000, h: 800 });

  it("hút mép trái vào mép trái của widget khác", () => {
    const { dx } = snapMove({ x: 303, y: 400, w: 80, h: 50 }, lines, 6);
    close(dx, -3);
  });

  it("hút tâm vào tâm artboard", () => {
    const { dx } = snapMove({ x: 458, y: 0, w: 80, h: 50 }, lines, 6); // tâm 498 → 500
    close(dx, 2);
  });

  it("không hút khi quá ngưỡng", () => {
    expect(snapMove({ x: 320, y: 420, w: 80, h: 50 }, lines, 6)).toEqual({ dx: 0, dy: 0 });
  });

  it("sinh đường gióng sau khi snap", () => {
    const g = guidesFor({ x: 300, y: 400, w: 80, h: 50 }, lines);
    const v = g.find((x) => x.orientation === "v" && x.pos === 300);
    expect(v).toBeDefined();
    expect(v!.from).toBe(100); // kéo dài tới widget kia
    expect(v!.to).toBe(450);
  });
});

describe("resizeGeometry", () => {
  it("kéo handle se khi chưa xoay", () => {
    const r = resizeGeometry({ x: 100, y: 100, w: 200, h: 100, rotation: 0 }, HANDLES.se, 50, 20);
    expect(r).toEqual({ x: 100, y: 100, w: 250, h: 120 });
  });

  it("kéo handle nw giữ nguyên góc đối diện", () => {
    const r = resizeGeometry({ x: 100, y: 100, w: 200, h: 100, rotation: 0 }, HANDLES.nw, -30, -10);
    expect(r).toEqual({ x: 70, y: 90, w: 230, h: 110 });
  });

  it("không nhỏ hơn kích thước tối thiểu", () => {
    const r = resizeGeometry({ x: 0, y: 0, w: 100, h: 100, rotation: 0 }, HANDLES.e, -500, 0, { minSize: 30 });
    expect(r.w).toBe(30);
  });

  it("giữ tỉ lệ khi kéo góc", () => {
    const r = resizeGeometry({ x: 0, y: 0, w: 200, h: 100, rotation: 0 }, HANDLES.se, 100, 0, { keepAspect: true });
    close(r.w / r.h, 2);
  });

  it("khi xoay 90°, điểm đối diện handle vẫn đứng yên trong không gian thế giới", () => {
    const start = { x: 100, y: 100, w: 200, h: 100, rotation: 90 };
    // Xoay 90°: trục x cục bộ hướng xuống màn hình, nên kéo xuống 40 làm w tăng 40.
    const r = resizeGeometry(start, HANDLES.se, 0, 40);
    close(r.w, 240);
    close(r.h, 100);
    // Điểm neo = góc nw cục bộ = tâm + R(90)(-100,-50) = (200+50, 150-100) = (250, 50).
    // Sau resize: neo = tâm mới + R(90)(-w'/2, -h'/2) = tâm mới + (50, -120).
    close(r.x + r.w / 2 + 50, 250);
    close(r.y + r.h / 2 - 120, 50);
  });
});

describe("misc", () => {
  it("normalizeAngle", () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(360)).toBe(0);
  });

  it("intersects", () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });
});
