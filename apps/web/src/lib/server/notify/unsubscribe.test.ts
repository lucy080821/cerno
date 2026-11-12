import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNotifyToken, unsubscribeApiUrl, unsubscribeConfigured, unsubscribePageUrl, verifyNotifyToken, type NotifyToken } from "./unsubscribe";

const SECRET = "x".repeat(40);
const ID = "11111111-2222-3333-4444-555555555555";
const tok: NotifyToken = { k: "report", r: ID, e: "an@example.com", a: "unsub" };

const old = process.env.UNSUBSCRIBE_SECRET;
beforeEach(() => { process.env.UNSUBSCRIBE_SECRET = SECRET; });
afterEach(() => { process.env.UNSUBSCRIBE_SECRET = old; });

describe("token huỷ nhận", () => {
  it("tạo rồi kiểm lại ra đúng nội dung; email được chuẩn hoá chữ thường", () => {
    const t = createNotifyToken({ ...tok, e: "An@Example.COM" });
    expect(verifyNotifyToken(t)).toEqual(tok);
  });

  it("sửa một ký tự bất kỳ (nội dung hoặc chữ ký) thì bị từ chối", () => {
    const t = createNotifyToken(tok);
    const [p, s] = t.split(".");
    const flip = (x: string) => x.slice(0, -2) + (x.endsWith("A") ? "B" : "A") + x.slice(-1);
    expect(verifyNotifyToken(`${flip(p)}.${s}`)).toBeNull();
    expect(verifyNotifyToken(`${p}.${flip(s)}`)).toBeNull();
    expect(verifyNotifyToken(`${p}.`)).toBeNull();
    expect(verifyNotifyToken(`${p}`)).toBeNull();
    expect(verifyNotifyToken(`${p}.${s}.x`)).toBeNull();
  });

  it("đổi nội dung (email khác) nhưng giữ chữ ký cũ thì bị từ chối", () => {
    const [, s] = createNotifyToken(tok).split(".");
    const forged = Buffer.from(JSON.stringify({ ...tok, e: "khac@example.com" })).toString("base64url");
    expect(verifyNotifyToken(`${forged}.${s}`)).toBeNull();
  });

  it("khoá khác thì không chấp nhận token của khoá cũ", () => {
    const t = createNotifyToken(tok);
    process.env.UNSUBSCRIBE_SECRET = "y".repeat(40);
    expect(verifyNotifyToken(t)).toBeNull();
  });

  it("chưa cấu hình / khoá quá ngắn: không tạo, không chấp nhận", () => {
    const t = createNotifyToken(tok);
    process.env.UNSUBSCRIBE_SECRET = "ngan";
    expect(unsubscribeConfigured()).toBe(false);
    expect(() => createNotifyToken(tok)).toThrow();
    expect(verifyNotifyToken(t)).toBeNull();
    delete process.env.UNSUBSCRIBE_SECRET;
    expect(verifyNotifyToken(t)).toBeNull();
  });

  it("hạn dùng: còn hạn thì được, hết hạn thì không; không đặt hạn thì luôn dùng được", () => {
    const t = createNotifyToken({ ...tok, a: "snooze", x: 1000 });
    expect(verifyNotifyToken(t, 999)?.a).toBe("snooze");
    expect(verifyNotifyToken(t, 1001)).toBeNull();
    expect(verifyNotifyToken(createNotifyToken(tok), 4_000_000_000)).not.toBeNull();
  });

  it("từ chối dữ liệu sai dạng: không phải chuỗi, quá dài, loại/việc lạ, id không phải uuid, email thiếu @", () => {
    expect(verifyNotifyToken(undefined)).toBeNull();
    expect(verifyNotifyToken(123)).toBeNull();
    expect(verifyNotifyToken("a".repeat(700))).toBeNull();
    for (const bad of [
      { ...tok, k: "khac" }, { ...tok, a: "xoa" }, { ...tok, r: "khong-phai-uuid" }, { ...tok, e: "khong-co-a-cong" },
    ]) {
      expect(() => createNotifyToken(bad as NotifyToken)).not.toThrow(); // tạo được (kiểm ở lúc đọc)
      expect(verifyNotifyToken(createNotifyToken(bad as NotifyToken))).toBeNull();
    }
  });

  it("URL", () => {
    const t = createNotifyToken(tok);
    expect(unsubscribePageUrl("https://cerno.cloud", t)).toBe(`https://cerno.cloud/unsubscribe?t=${encodeURIComponent(t)}`);
    expect(unsubscribeApiUrl("https://cerno.cloud", t)).toContain("/api/unsubscribe?t=");
  });
});
