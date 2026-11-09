import { describe, expect, it } from "vitest";
import { safeNext } from "./next";

const ID = "123e4567-e89b-12d3-a456-426614174000";

describe("safeNext", () => {
  it("nhận các trang cần đăng nhập của app", () => {
    expect(safeNext(`/editor/${ID}`)).toBe(`/editor/${ID}`);
    expect(safeNext(encodeURIComponent(`/d/${ID}`))).toBe(`/d/${ID}`);
    expect(safeNext("/dashboards")).toBe("/dashboards");
  });
  it("từ chối địa chỉ ngoài, giao thức lạ, đường dẫn lạ", () => {
    for (const bad of [
      "", null, undefined, "https://evil.com", "//evil.com", "/\evil.com", "javascript:alert(1)",
      "/editor/../../x", `/editor/${ID}/../x`, `/editor/${ID}?x=1`, "/api/sources", "/login", "%E0%A4%A",
      `/editor/${ID}%0d%0aSet-Cookie:x=1`,
    ]) {
      expect(safeNext(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });
});
