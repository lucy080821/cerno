import { describe, expect, it } from "vitest";
import { sourceColumns, toDataSource } from "./source";

const row = {
  id: "s1", name: "File › Tab", sheet_name: "Tab", spreadsheet_id: "abc",
  columns: [{ name: "A", type: "number", unit: "đồng" }, { name: "B", type: "lạ" }],
};

describe("nguồn cho mẫu", () => {
  it("chuẩn hoá kiểu cột lạ thành chữ", () => {
    expect(sourceColumns(row)).toEqual([{ name: "A", type: "number" }, { name: "B", type: "string" }]);
  });
  it("tạo mục nguồn Google Sheets, giữ đơn vị", () => {
    expect(toDataSource(row)).toEqual({
      id: "s1", type: "google_sheets", spreadsheetId: "abc", sheetName: "File › Tab",
      columns: [{ name: "A", type: "number", unit: "đồng" }, { name: "B", type: "string" }],
    });
    expect(toDataSource({ ...row, name: null }).type === "google_sheets" && toDataSource({ ...row, name: null })).toMatchObject({ sheetName: "Tab" });
  });
});
