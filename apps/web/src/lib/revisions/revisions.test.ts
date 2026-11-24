import { describe, expect, it } from "vitest";
import { formatRevisionTime, revisionError } from "./revisions";

describe("lịch sử phiên bản", () => {
  it("định dạng giờ Việt Nam: hôm nay, hôm qua, ngày khác", () => {
    const now = new Date("2026-11-24T08:00:00Z"); // 15:00 giờ VN
    expect(formatRevisionTime("2026-11-24T07:05:00Z", now)).toBe("Hôm nay 14:05");
    expect(formatRevisionTime("2026-11-23T02:30:00Z", now)).toBe("Hôm qua 09:30");
    expect(formatRevisionTime("2026-11-20T11:20:00Z", now)).toBe("20/11 18:20");
    expect(formatRevisionTime("không phải ngày", now)).toBe("—");
  });
  it("lỗi thân thiện, không lộ thông báo thô của DB", () => {
    expect(revisionError('relation "public.dashboard_revisions" does not exist')).toContain("migration 0024");
    expect(revisionError("forbidden")).toContain("không có quyền");
    expect(revisionError("named_limit")).toContain("20 mốc");
    expect(revisionError("duplicate key value violates unique constraint x")).toBe("Không thực hiện được, hãy thử lại.");
    expect(revisionError(undefined)).toBe("Không thực hiện được, hãy thử lại.");
  });
});
