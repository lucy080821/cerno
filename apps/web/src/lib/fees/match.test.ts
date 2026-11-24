import { describe, expect, it } from "vitest";
import { ALIASES, suggestCategory } from "./match";
import { categoryRate } from "./tables";

const path = (name: string, type: "non_mall" | "mall" = "non_mall") => suggestCategory("Shopee", type, name)?.path ?? null;

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
    const g = suggestCategory("Shopee", "non_mall", "Chảo chống dính 24cm")!;
    expect(g.ratePct).toBe(categoryRate("Shopee", "non_mall", g.path));
    expect(g.source).toBe("name");
    expect(suggestCategory("Shopee", "non_mall", "Áo thun nữ")!.source).toBe("alias");
  });

  it("không đoán được thì trả null, không bịa", () => {
    expect(suggestCategory("Shopee", "non_mall", "")).toBeNull();
    expect(suggestCategory("Shopee", "non_mall", null)).toBeNull();
    expect(suggestCategory("Shopee", "non_mall", "xyz abc qwerty")).toBeNull();
    expect(suggestCategory("Shopee", "non_mall", "Combo 123 hàng")).toBeNull();
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
      const g = suggestCategory("Shopee", "mall", n);
      if (g) expect(categoryRate("Shopee", "mall", g.path)).toBe(g.ratePct);
    }
  });

  it("ổn định: cùng tên cho cùng kết quả", () => {
    expect(suggestCategory("Shopee", "non_mall", "Kem chống nắng SPF50 50g")).toEqual(suggestCategory("Shopee", "non_mall", "Kem chống nắng SPF50 50g"));
  });

  it("mọi đường dẫn trong bảng cụm từ có trong biểu phí shop thường", () => {
    for (const a of ALIASES.Shopee) expect(categoryRate("Shopee", "non_mall", a.path), a.path).not.toBeNull();
    for (const a of ALIASES["TikTok Shop"]) for (const t of ["non_mall", "mall"] as const) expect(categoryRate("TikTok Shop", t, a.path), a.path).not.toBeNull();
  });

  it("TikTok Shop: nhận diện theo biểu phí của TikTok", () => {
    const tt = (n: string, t: "non_mall" | "mall" = "non_mall") => suggestCategory("TikTok Shop", t, n);
    expect(tt("Áo thun cotton basic")?.path).toBe("Trang phục nam & Đồ lót › Áo nam › Áo thun");
    expect(tt("Sữa rửa mặt dịu nhẹ 150ml")?.path).toBe("Chăm sóc sắc đẹp & Chăm sóc cá nhân › Chăm sóc da › Sữa rửa mặt");
    expect(tt("Kem chống nắng SPF50 50g")?.path).toMatch(/Kem chống nắng/);
    expect(tt("Túi tote canvas")?.path).toMatch(/Túi tote$/);
    expect(tt("Chảo chống dính 24cm")?.path).toBe("Đồ dùng nhà bếp › Đồ nấu ăn › Xoong & Chảo");
    expect(tt("Khăn tắm sợi tre")?.path).toBe("Đồ gia dụng › Đồ dùng phòng tắm › Khăn tắm");
    expect(tt("xyz abc qwerty")).toBeNull();
    const g = tt("Chảo chống dính 24cm")!;
    expect(g.ratePct).toBe(categoryRate("TikTok Shop", "non_mall", g.path));
    // Mall có mức phí khác shop thường cho cùng ngành.
    expect(tt("Áo thun cotton basic", "mall")!.ratePct).not.toBe(tt("Áo thun cotton basic")!.ratePct);
  });

  it("TikTok Shop: không rơi vào ngành 'Đã qua sử dụng' khi tên không nhắc tới", () => {
    for (const n of ["Áo thun cotton basic", "Túi tote canvas", "Khăn tắm sợi tre"]) {
      expect(suggestCategory("TikTok Shop", "non_mall", n)?.path ?? "").not.toMatch(/^Đã qua sử dụng/);
    }
  });
});
