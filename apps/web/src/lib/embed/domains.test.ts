import { describe, expect, it } from "vitest";
import { frameAncestors, normalizeDomain, parseDomains } from "./domains";

describe("normalizeDomain", () => {
  it("chuẩn hoá chữ hoa, giao thức, đường dẫn, cổng, dấu chấm cuối", () => {
    expect(normalizeDomain("CongTy.com")).toBe("congty.com");
    expect(normalizeDomain("https://www.congty.com/trang/bao-cao?x=1#a")).toBe("www.congty.com");
    expect(normalizeDomain("http://congty.com:8080/")).toBe("congty.com");
    expect(normalizeDomain("congty.com.")).toBe("congty.com");
  });
  it("nhận wildcard và localhost", () => {
    expect(normalizeDomain("*.congty.com")).toBe("*.congty.com");
    expect(normalizeDomain("localhost:3000")).toBe("localhost");
  });
  it("đổi tên miền có dấu sang punycode", () => {
    expect(normalizeDomain("tên-miền.vn")).toMatch(/^xn--[a-z0-9-]+\.vn$/);
  });
  it("từ chối giá trị nguy hiểm hoặc không phải tên miền", () => {
    for (const bad of [
      "", "   ", "*", "*.", "*.*.com", "com", "*.localhost", "192.168.1.1", "[::1]",
      "a b.com", "a.com;script-src *", "a.com' 'unsafe-inline", "a.com\nb.com", "user@congty.com",
      "https://", "-a.com", "a-.com", "a..com", "congty.c", "a.com%0d", "a_b.com", "'self'", "data:",
    ]) {
      expect(normalizeDomain(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("parseDomains", () => {
  it("tách theo dòng/dấu phẩy, bỏ trùng, gom dòng sai", () => {
    const r = parseDomains("congty.com\nWWW.congty.com, congty.com ; *.abc.vn\nxx yy\n???");
    expect(r.domains).toEqual(["congty.com", "www.congty.com", "*.abc.vn", "xx"].filter((d) => d !== "xx"));
    expect(r.invalid).toEqual(["xx", "yy", "???"]);
    expect(r.tooMany).toBe(false);
  });
  it("báo quá nhiều", () => {
    const many = Array.from({ length: 21 }, (_, i) => `site${i}.com`).join("\n");
    expect(parseDomains(many).tooMany).toBe(true);
  });
});

describe("frameAncestors", () => {
  it("rỗng thì không ai nhúng được", () => {
    expect(frameAncestors([])).toBe("frame-ancestors 'none'");
  });
  it("tên miền thường gồm cả www", () => {
    expect(frameAncestors(["congty.com"])).toBe("frame-ancestors https://congty.com https://www.congty.com");
  });
  it("wildcard gồm cả tên miền gốc", () => {
    expect(frameAncestors(["*.congty.com"])).toBe("frame-ancestors https://congty.com https://*.congty.com");
  });
  it("localhost mọi cổng", () => {
    expect(frameAncestors(["localhost"])).toContain("http://localhost:*");
  });
  it("mục bẩn trong dữ liệu bị bỏ, không lọt vào header", () => {
    const h = frameAncestors(["a.com; script-src *", "ok.com"]);
    expect(h).toBe("frame-ancestors https://ok.com https://www.ok.com");
    expect(h).not.toContain(";");
  });
});
