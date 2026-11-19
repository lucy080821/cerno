import { describe, expect, it } from "vitest";
import { parseOpenParam } from "./open-param";

describe("?open= của editor", () => {
  it("chỉ nhận các giá trị đã biết", () => {
    expect(parseOpenParam("?open=ai")).toBe("ai");
    expect(parseOpenParam("?x=1&open=share")).toBe("share");
    expect(parseOpenParam("?open=alerts")).toBe("alerts");
    expect(parseOpenParam("?open=reports")).toBe("reports");
    expect(parseOpenParam("?open=hack")).toBeNull();
    expect(parseOpenParam("")).toBeNull();
  });
});
