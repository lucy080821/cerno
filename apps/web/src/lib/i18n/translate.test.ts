import { describe, expect, it } from "vitest";
import { makeTranslator } from "./translate";
import { translateToEnglish, tr } from "./index";

describe("makeTranslator", () => {
  const t = makeTranslator({
    "Lưu": "Save",
    "Xóa \"{0}\"?": "Delete \"{0}\"?",
    "{0} trên {1}": "{1} of {0}",
    "{0} phút trước": "{0} min ago",
    "Đã thêm {0} dòng.": "Added {0} rows.",
  });

  it("khớp chính xác và giữ khoảng trắng hai đầu", () => {
    expect(t("Lưu")).toBe("Save");
    expect(t("  Lưu \n")).toBe("  Save \n");
  });
  it("gộp khoảng trắng bên trong trước khi tra (xuống dòng trong JSX)", () => {
    const u = makeTranslator({ "Xin   chào bạn": "Hello you" });
    expect(u("Xin\n   chào\tbạn")).toBe("Hello you");
  });
  it("không có trong từ điển thì trả null", () => {
    expect(t("Chưa có")).toBeNull();
    expect(t("   ")).toBeNull();
  });
  it("mẫu có {0}: thay đúng phần đã khớp", () => {
    expect(t("Xóa \"Doanh thu\"?")).toBe("Delete \"Doanh thu\"?");
    expect(t("5 phút trước")).toBe("5 min ago");
    expect(t("Đã thêm 1.234 dòng.")).toBe("Added 1.234 rows.");
  });
  it("mẫu đổi được thứ tự các phần", () => {
    expect(t("3 trên 10")).toBe("10 of 3");
  });
  it("ký tự đặc biệt của regex trong khoá không làm hỏng mẫu", () => {
    const u = makeTranslator({ "Giá (đ) [{0}] + ?": "Price (VND) [{0}] + ?" });
    expect(u("Giá (đ) [abc] + ?")).toBe("Price (VND) [abc] + ?");
  });
  it("mẫu cụ thể hơn được ưu tiên", () => {
    const u = makeTranslator({ "{0}": "ANY", "Tổng {0} đơn": "Total {0} orders" });
    expect(u("Tổng 5 đơn")).toBe("Total 5 orders");
  });
});

describe("từ điển thật", () => {
  it("dịch được vài câu giao diện chính", () => {
    expect(translateToEnglish("Đăng nhập với Google")).toBe("Sign in with Google");
    expect(translateToEnglish("Chia sẻ")).toBe("Share");
    expect(translateToEnglish("5 phút trước")).toBe("5 min ago");
  });
  it("tr(): tiếng Việt giữ nguyên, tiếng Anh dịch, chuỗi lạ giữ nguyên", () => {
    expect(tr("Chia sẻ", "vi")).toBe("Chia sẻ");
    expect(tr("Chia sẻ", "en")).toBe("Share");
    expect(tr("Chuỗi lạ chưa dịch", "en")).toBe("Chuỗi lạ chưa dịch");
  });
});
