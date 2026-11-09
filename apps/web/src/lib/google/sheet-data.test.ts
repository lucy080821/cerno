import { describe, expect, it } from "vitest";
import { inferType, parseDuration, parseNumber, sheetToTable } from "./sheet-data";

describe("parseNumber", () => {
  it("hiểu định dạng Việt Nam và quốc tế", () => {
    expect(parseNumber("1.234.567")).toBe(1234567);
    expect(parseNumber("1,234,567")).toBe(1234567);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("0.5")).toBe(0.5);
    expect(parseNumber("45%")).toBe(45);
    expect(parseNumber("1.200đ")).toBe(1200);
    expect(parseNumber("-300")).toBe(-300);
  });
  it("từ chối chữ", () => {
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("12-34")).toBeNull();
  });
});

describe("inferType", () => {
  it("nhận diện ngày, số, bool, chữ", () => {
    expect(inferType(["2025-01-02", "03/02/2025", ""])).toBe("date");
    expect(inferType(["10", "20", "1.500"])).toBe("number");
    expect(inferType(["true", "false"])).toBe("boolean");
    expect(inferType(["Hà Nội", "10"])).toBe("string");
  });
  it("chịu được vài ô lỗi (≥90%)", () => {
    expect(inferType([...Array(19).fill("5"), "n/a"])).toBe("number");
    expect(inferType([...Array(8).fill("5"), "n/a", "x"])).toBe("string");
  });
});

describe("sheetToTable", () => {
  it("tạo cột, chuyển kiểu, bỏ dòng trống, đổi tên tiêu đề trùng/rỗng", () => {
    const t = sheetToTable([
      ["Tên", "Tên", "", "Doanh thu"],
      ["A", "B", "x", "1.000"],
      ["", "", "", ""],
      ["C", "D", "y", "2.500"],
    ]);
    expect(t.columns.map((c) => c.name)).toEqual(["Tên", "Tên (2)", "Cột 3", "Doanh thu"]);
    expect(t.columns[3].type).toBe("number");
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]["Doanh thu"]).toBe(2500);
  });
  it("sheet rỗng", () => {
    expect(sheetToTable([]).rows).toEqual([]);
  });
});

describe("thời lượng và ô rỗng giả", () => {
  it("parseDuration", () => {
    expect(parseDuration("0:00:27")).toBe(27);
    expect(parseDuration("1:02:10")).toBe(3730);
    expect(parseDuration("3:25")).toBe(205);
    expect(parseDuration("12")).toBeNull();
  });
  it("cột h:mm:ss thành số giây có đơn vị", () => {
    const t = sheetToTable([["Thời gian xem"], ["0:00:27"], ["0:03:33"], ["-"]]);
    expect(t.columns[0]).toEqual({ name: "Thời gian xem", type: "number", unit: "giây" });
    expect(t.rows.map((r) => r["Thời gian xem"])).toEqual([27, 213, null]);
  });
  it("bỏ qua '-', 'n/a', '—' khi đoán kiểu", () => {
    expect(inferType(["10", "—", "n/a", "20", "-", "30"])).toBe("number");
    const t = sheetToTable([["Lượt"], ["10"], ["n/a"], ["20"]]);
    expect(t.rows.map((r) => r["Lượt"])).toEqual([10, null, 20]);
  });
  it("cột rỗng hoàn toàn là chữ", () => {
    expect(sheetToTable([["A"], [""], [""]]).columns[0].type).toBe("string");
  });
});
