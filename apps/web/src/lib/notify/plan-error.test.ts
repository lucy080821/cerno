import { describe, expect, it } from "vitest";
import { PlanLimitError, errorFrom, isPlanLimit } from "./plan-error";

describe("errorFrom", () => {
  it("code plan_limit → PlanLimitError giữ nguyên thông báo", () => {
    const e = errorFrom({ error: "Gói Miễn phí chỉ có 1 người nhận.", code: "plan_limit" });
    expect(isPlanLimit(e)).toBe(true);
    expect(e).toBeInstanceOf(PlanLimitError);
    expect(e.message).toBe("Gói Miễn phí chỉ có 1 người nhận.");
  });
  it("lỗi thường → Error thường; thiếu nội dung → thông báo mặc định", () => {
    const e = errorFrom({ error: "Không lưu được" });
    expect(isPlanLimit(e)).toBe(false);
    expect(e.message).toBe("Không lưu được");
    expect(errorFrom(null).message).toMatch(/thử lại/);
    expect(errorFrom({ code: "plan_limit" }).message).toMatch(/thử lại/);
  });
});
