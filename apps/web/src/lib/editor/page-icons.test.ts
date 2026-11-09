import { describe, expect, it } from "vitest";
import { getPageIcon, PAGE_ICONS } from "./page-icons";

describe("page-icons", () => {
  it("key không trùng, có path, nhóm không rỗng", () => {
    expect(new Set(PAGE_ICONS.map((i) => i.key)).size).toBe(PAGE_ICONS.length);
    for (const i of PAGE_ICONS) {
      expect(i.paths.length).toBeGreaterThan(0);
      expect(i.group && i.label).toBeTruthy();
      for (const d of i.paths) expect(d).toMatch(/^M/);
    }
  });
  it("key lạ rơi về icon mặc định", () => {
    expect(getPageIcon("không-có").key).toBe("page");
    expect(getPageIcon(undefined).key).toBe("page");
    expect(getPageIcon("bank").key).toBe("bank");
  });
});
