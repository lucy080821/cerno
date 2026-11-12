import { describe, expect, it } from "vitest";
import { AlertCondition } from "@dashboard/schema";
import { EN_DICT } from "@/lib/i18n";
import { aiParseViolation, alertViolation, mailLimitMessage, reportViolation } from "./plan";

/** Mọi thông báo giới hạn của gói có thể hiện ra phải có bản dịch tiếng Anh (chúng ghép động nên coverage test không thấy). */
function allMessages(): string[] {
  const out = new Set<string>();
  const conds = [
    { type: "threshold", op: "lt", value: 1 }, { type: "change", op: "drop_pct", value: 5, vs: "prev_period" },
    { type: "anomaly", sensitivity: "low", lookback: 4 }, { type: "per_group", inner: { type: "threshold", op: "lt", value: 1 } }, { type: "stale", hours: 1 },
  ].map((c) => AlertCondition.parse(c));
  for (const plan of ["free", "paid"] as const) {
    for (const frequency of ["daily", "weekly", "monthly"] as const) {
      for (const n of [0, 1, 5, 19, 20, 29, 30, 99]) {
        for (const isNew of [true, false]) {
          const v = reportViolation(plan, { frequency }, n, isNew);
          if (v) out.add(v.message);
        }
      }
    }
    for (const condition of conds) {
      for (const channels of [["email"], ["email", "telegram"]]) {
        for (const n of [0, 1, 2, 29, 30, 99]) {
          const v = alertViolation(plan, { condition, channels }, n, true);
          if (v) out.add(v.message);
        }
      }
    }
    if (plan === "free") out.add(aiParseViolation(plan).message); // gói trả phí không giới hạn nên không bao giờ gặp thông báo này
    out.add(mailLimitMessage(plan));
  }
  return [...out].sort();
}

describe("thông báo giới hạn của gói", () => {
  it("mọi thông báo đều có bản dịch tiếng Anh", () => {
    const missing = allMessages().filter((m) => !(m in EN_DICT));
    expect(missing, `Thiếu bản dịch:\n${missing.join("\n")}`).toEqual([]);
  });
});
