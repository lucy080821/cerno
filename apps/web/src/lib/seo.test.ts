import { afterEach, describe, expect, it } from "vitest";
import { jsonLd, siteUrl } from "./seo";

describe("jsonLd", () => {
  it("không để nội dung đóng được thẻ script", () => {
    const out = jsonLd({ q: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(JSON.parse(out).q).toBe("</script><script>alert(1)</script>");
  });

  it("thoát ký tự ngắt dòng Unicode", () => {
    const out = jsonLd({ s: `a${String.fromCharCode(0x2028)}b` });
    expect(out).not.toContain(String.fromCharCode(0x2028));
    expect(JSON.parse(out).s).toBe(`a${String.fromCharCode(0x2028)}b`);
  });
});

describe("siteUrl", () => {
  const old = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => {
    if (old === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = old;
  });

  it("bỏ dấu / cuối và mặc định về localhost", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://vi-du.com//";
    expect(siteUrl()).toBe("https://vi-du.com");
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(siteUrl()).toBe("http://localhost:3000");
  });
});
