import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "./index";

describe("ảnh minh họa của mẫu", () => {
  const pub = path.resolve(__dirname, "../../../public");

  it("mọi mẫu có file ảnh webp tồn tại (chạy `npm run shoot:templates` khi thêm mẫu mới)", () => {
    const missing = TEMPLATES.filter((e) => !e.previewImage || !fs.existsSync(path.join(pub, e.previewImage))).map((e) => e.template.id);
    expect(missing).toEqual([]);
  });

  it("ảnh là webp thật và nhẹ", () => {
    for (const e of TEMPLATES) {
      const f = path.join(pub, e.previewImage ?? "");
      if (!fs.existsSync(f)) continue;
      const b = fs.readFileSync(f);
      expect(b.subarray(0, 4).toString(), e.template.id).toBe("RIFF");
      expect(b.subarray(8, 12).toString(), e.template.id).toBe("WEBP");
      expect(b.length, e.template.id).toBeLessThan(300 * 1024);
    }
  });
});
