import { describe, expect, it } from "vitest";
import { ALIASES, suggestCategory } from "./match";
import { categoryRate } from "./shopee";

const path = (name: string, type: "non_mall" | "mall" = "non_mall") => suggestCategory(type, name)?.path ?? null;

describe("tự nhận diện ngành hàng từ tên sản phẩm", () => {
  it("8 sản phẩm của file mô phỏng ra đúng ngành", () => {
    expect(path("Áo thun cotton basic")).toBe("Thời Trang Nam › Áo › Khác");
    expect(path("Bình giữ nhiệt inox 500ml")).toBe("Nhà cửa & Đời sống › Bộ đồ bàn ăn › Bình nước");
    expect(path("Túi tote canvas")).toBe("Túi Ví Nữ › Túi tote");
    expect(path("Sữa rửa mặt dịu nhẹ 150ml")).toBe("Sắc Đẹp › Chăm sóc da mặt › Sữa rửa mặt");
    expect(path("Kem chống nắng SPF50 50g")).toBe("Sắc Đẹp › Chăm sóc da mặt › Kem chống nắng cho mặt");
    expect(path("Chảo chống dính 24cm")).toBe("Nhà cửa & Đời sống › Dụng cụ nhà bếp › Chảo");
    expect(path("Đèn bàn LED học tập")).toBe("Nhà cửa & Đời sống › Đèn");
    expect(path("Khăn tắm sợi tre")).toBe("Nhà cửa & Đời sống › Đồ dùng phòng tắm › Khăn mặt, khăn tắm, áo choàng tắm");
  });

  it("kèm mức phí đúng như trong biểu phí", () => {
    const g = suggestCategory("non_mall", "Chảo chống dính 24cm")!;
    expect(g.ratePct).toBe(categoryRate("non_mall", g.path));
    expect(g.source).toBe("name");
    expect(suggestCategory("non_mall", "Áo thun nữ")!.source).toBe("alias");
  });

  it("không đoán được thì trả null, không bịa", () => {
    expect(suggestCategory("non_mall", "")).toBeNull();
    expect(suggestCategory("non_mall", null)).toBeNull();
    expect(suggestCategory("non_mall", "xyz abc qwerty")).toBeNull();
    expect(suggestCategory("non_mall", "Combo 123 hàng")).toBeNull();
  });

  it("không khớp nhầm sang ngành chuyên biệt khi tên không nhắc tới", () => {
    for (const n of ["Khăn tắm sợi tre", "Đèn bàn LED học tập", "Bình giữ nhiệt inox 500ml"]) {
      expect(path(n)).not.toMatch(/^(Mẹ & Bé|Mô tô|Cameras|Phụ tùng)/);
    }
  });

  it("tên có nhắc tới ngành chuyên biệt thì vẫn khớp", () => {
    expect(path("Bình sữa cho bé 240ml")).toMatch(/^Mẹ & Bé/);
  });

  it("chạy được cho Shopee Mall và kết quả luôn có trong biểu phí của loại shop đó", () => {
    for (const n of ["Chảo chống dính 24cm", "Sữa rửa mặt dịu nhẹ 150ml", "Túi tote canvas", "Áo thun cotton basic"]) {
      const g = suggestCategory("mall", n);
      if (g) expect(categoryRate("mall", g.path)).toBe(g.ratePct);
    }
  });

  it("ổn định: cùng tên cho cùng kết quả", () => {
    expect(suggestCategory("non_mall", "Kem chống nắng SPF50 50g")).toEqual(suggestCategory("non_mall", "Kem chống nắng SPF50 50g"));
  });

  it("mọi đường dẫn trong bảng cụm từ có trong biểu phí shop thường", () => {
    for (const a of ALIASES) expect(categoryRate("non_mall", a.path), a.path).not.toBeNull();
  });
});
