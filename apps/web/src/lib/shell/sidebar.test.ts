import { describe, expect, it } from "vitest";
import { avatarUrlOf, badgeText, channelLine, initialsOf, shopName, usageRatio } from "./sidebar";

describe("thanh bên", () => {
  it("tên cửa hàng bỏ hậu tố workspace cá nhân", () => {
    expect(shopName("Lan Anh – cá nhân", "x")).toBe("Lan Anh");
    expect(shopName("Lan Anh Store", "x")).toBe("Lan Anh Store");
    expect(shopName(" – cá nhân", "Tuấn")).toBe("Tuấn");
    expect(shopName(null, "")).toBe("Cửa hàng của bạn");
  });
  it("chữ viết tắt", () => {
    expect(initialsOf("Lan Anh Store")).toBe("LS");
    expect(initialsOf("lan anh")).toBe("LA");
    expect(initialsOf("đức")).toBe("ĐỨ");
    expect(initialsOf("ten.nguoi@gmail.com")).toBe("TN");
    expect(initialsOf("")).toBe("C");
  });
  it("dòng kênh xếp theo số đơn, tối đa 3", () => {
    expect(channelLine([])).toBe("");
    expect(channelLine([{ channel: "TikTok Shop", orders: 3 }, { channel: "Shopee", orders: 9 }])).toBe("Shopee · TikTok Shop");
    expect(channelLine(["A", "B", "C", "D", "E"].map((c, i) => ({ channel: c, orders: 10 - i })))).toBe("A · B · C +2");
  });
  it("tỉ lệ và huy hiệu", () => {
    expect(usageRatio(3, 10)).toBe(0.3);
    expect(usageRatio(12, 10)).toBe(1);
    expect(usageRatio(1, 0)).toBe(0);
    expect(badgeText(0)).toBeNull();
    expect(badgeText(5)).toBe("5");
    expect(badgeText(150)).toBe("99+");
  });
  it("ảnh đại diện chỉ nhận ảnh https của Google", () => {
    const g = "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c";
    expect(avatarUrlOf({ avatar_url: g })).toBe(g);
    expect(avatarUrlOf({ picture: g })).toBe(g);
    expect(avatarUrlOf({ avatar_url: "https://evil.example.com/x.png", picture: g })).toBe(g);
    expect(avatarUrlOf({ avatar_url: "http://lh3.googleusercontent.com/a" })).toBeNull();
    expect(avatarUrlOf({ avatar_url: "https://googleusercontent.com.evil.com/a" })).toBeNull();
    expect(avatarUrlOf({ avatar_url: "javascript:alert(1)" })).toBeNull();
    expect(avatarUrlOf({ avatar_url: 5 })).toBeNull();
    expect(avatarUrlOf(null)).toBeNull();
    expect(avatarUrlOf({})).toBeNull();
  });
});
