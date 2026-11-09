import { beforeEach, describe, expect, it } from "vitest";
import { buildAiContext, CONTEXT_LEVELS, MAX_CONTEXT_LEVEL } from "./ai-context";
import { resetCalcSync, syncCalc } from "./calc";
import { createDemoDashboard } from "./defaults";

const doc = createDemoDashboard();
beforeEach(() => {
  resetCalcSync();
  syncCalc(doc);
});

const ctx = (level: number, d = doc) => buildAiContext(d, [], {}, [], undefined, level);

describe("buildAiContext: ngân sách cho dịch vụ AI (8.000 token/phút)", () => {
  it("càng lên cấp càng gọn, và luôn nằm trong ngân sách ký tự của cấp đó", async () => {
    const sizes: number[] = [];
    for (let l = 0; l <= MAX_CONTEXT_LEVEL; l++) {
      const out = await ctx(l);
      expect(out.length, `cấp ${l}`).toBeLessThanOrEqual(CONTEXT_LEVELS[l].maxChars + 60); // +dòng báo cắt bớt
      sizes.push(out.length);
    }
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
    expect(sizes[MAX_CONTEXT_LEVEL]).toBeLessThan(sizes[0]);
  });

  it("dashboard nhỏ thì nguyên vẹn (JSON hợp lệ, không bị cắt) ở cấp đầy đủ", async () => {
    const out = await ctx(0);
    expect(out).not.toContain("đã cắt bớt");
    const j = JSON.parse(out);
    expect(j.widgets.length).toBeGreaterThan(0);
    expect(j.nguonDuLieu[0].thongKeCotSo.length).toBeGreaterThan(0);
  });

  it("cấp gọn bỏ thống kê cột và dòng mẫu; cấp đầy đủ giữ", async () => {
    const full = JSON.parse(await ctx(0)).nguonDuLieu[0];
    const lean = JSON.parse(await ctx(2)).nguonDuLieu[0];
    expect(full.thongKeCotSo).toBeDefined();
    expect(full.dongMau).toBeDefined();
    expect(lean.thongKeCotSo).toBeUndefined();
    expect(lean.dongMau.length).toBeLessThanOrEqual(CONTEXT_LEVELS[2].sampleRows);
  });

  it("dashboard rất lớn vẫn không vượt ngân sách (bị cắt có báo)", async () => {
    const many = { ...doc, widgets: Array.from({ length: 12 }, (_, i) => doc.widgets.map((w) => ({ ...w, id: `${w.id}_${i}` }))).flat() };
    for (const l of [1, 2, 3]) {
      const out = await ctx(l, many);
      expect(out.length).toBeLessThanOrEqual(CONTEXT_LEVELS[l].maxChars + 60);
    }
  });

  it("cấp ngoài khoảng được kẹp lại, không lỗi", async () => {
    expect((await ctx(-5)).length).toBe((await ctx(0)).length);
    expect((await ctx(99)).length).toBe((await ctx(MAX_CONTEXT_LEVEL)).length);
  });
});
