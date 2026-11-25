import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

/**
 * Hộp thoại dựng ngay trong ô bảng/thẻ cha kế thừa chữ không xuống dòng, căn phải, cỡ nhỏ (đã gặp: hộp thoại "Tải file đơn hàng"
 * mở từ ô thao tác của bảng nguồn bị tràn ngang, mất tiêu đề). Mọi lớp phủ hộp thoại của các trang phải cắt kế thừa bằng `modal-reset`.
 */
describe("lớp phủ hộp thoại cắt kế thừa kiểu chữ của chỗ mở", () => {
  const files: Array<[string, RegExp]> = [
    ["app/(app)/dashboards/templates.module.css", /\.backdrop \{\s*composes: reset from "[^"]*modal-reset\.module\.css";/],
    ["app/(app)/dashboards/template-preview.module.css", /\.backdrop \{\s*composes: reset from "[^"]*modal-reset\.module\.css";/],
    ["components/profit/profit.module.css", /\.overlay \{\s*composes: reset from "[^"]*modal-reset\.module\.css";/],
  ];
  for (const [file, re] of files) {
    it(file, () => {
      expect(readFileSync(join(SRC, file), "utf8")).toMatch(re);
    });
  }

  it("lớp reset đặt lại những thuộc tính hay bị kế thừa nhầm", () => {
    const css = readFileSync(join(SRC, "components/ui/modal-reset.module.css"), "utf8");
    for (const prop of ["white-space: normal", "text-align: left", "text-transform: none", "letter-spacing: normal"]) expect(css).toContain(prop);
  });
});
