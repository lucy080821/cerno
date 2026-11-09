import { describe, expect, it } from "vitest";
import { ATTEMPT_COOLDOWN_MINUTES, AUTO_SYNC_MINUTES, isDue } from "./constants";
import { hashValues } from "./sheet-data";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const state = (synced: number | null, attempt: number | null, interval = AUTO_SYNC_MINUTES) => ({
  last_synced_at: synced === null ? null : ago(synced),
  last_attempt_at: attempt === null ? null : ago(attempt),
  sync_interval_minutes: interval,
});

describe("isDue: khi nào nguồn đến hạn tự cập nhật", () => {
  it("chu kỳ mặc định là 2 giờ", () => {
    expect(AUTO_SYNC_MINUTES).toBe(120);
  });
  it("chưa từng đồng bộ thì đến hạn ngay", () => {
    expect(isDue(state(null, null), NOW)).toBe(true);
  });
  it("chưa đủ 2 giờ thì chưa đến hạn; đủ hoặc quá thì đến hạn", () => {
    expect(isDue(state(119, 119), NOW)).toBe(false);
    expect(isDue(state(120, 120), NOW)).toBe(true);
    expect(isDue(state(500, 500), NOW)).toBe(true);
  });
  it("tôn trọng chu kỳ riêng của từng nguồn", () => {
    expect(isDue(state(30, 30, 15), NOW)).toBe(true);
    expect(isDue(state(30, 30, 60), NOW)).toBe(false);
  });
  it("nguồn vừa thử mà lỗi thì chờ thêm, không bị gọi dồn dập", () => {
    expect(isDue(state(600, ATTEMPT_COOLDOWN_MINUTES - 1), NOW)).toBe(false);
    expect(isDue(state(600, ATTEMPT_COOLDOWN_MINUTES), NOW)).toBe(true);
    expect(isDue(state(null, 1), NOW)).toBe(false);
  });
});

describe("hashValues: dấu vân tay nội dung sheet", () => {
  const a = [["Tên", "Điểm"], ["An", "10"], ["Bình", "9"]];
  it("cùng nội dung thì cùng dấu vân tay", () => {
    expect(hashValues(a)).toBe(hashValues(JSON.parse(JSON.stringify(a))));
  });
  it("đổi một ô, thêm dòng, hay đổi thứ tự cột đều đổi dấu vân tay", () => {
    const changed = [["Tên", "Điểm"], ["An", "10"], ["Bình", "8"]];
    const added = [...a, ["Chi", "7"]];
    const swapped = [["Điểm", "Tên"], ["10", "An"], ["9", "Bình"]];
    const set = new Set([hashValues(a), hashValues(changed), hashValues(added), hashValues(swapped)]);
    expect(set.size).toBe(4);
  });
  it("là chuỗi hex 64 ký tự (SHA-256)", () => {
    expect(hashValues(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
