import type { Dict } from "../translate";

/** Ước tính phí sàn Shopee: trang Sản phẩm và giá vốn, hộp thoại chọn ngành, ghi chú ở các trang lãi, thông báo của API. */
export const EN_FEES: Dict = {
  "Ước tính phí sàn Shopee": "Shopee fee estimate",
  "biểu phí từ {0}": "fee table from {0}",
  "Khi file đơn hàng Shopee không có cột phí, Cerno ước tính phí sàn: Phí Cố Định theo ngành hàng của từng sản phẩm, Phí Xử Lý Giao Dịch": "When a Shopee order file has no fee columns, Cerno estimates the marketplace fees: the Fixed Fee by each product's category, the Transaction Processing Fee of",
  "% và Phí Hạ Tầng": "% and the Infrastructure Fee of",
  "đ mỗi đơn (đã gồm thuế). Đơn có phí trong file thì dùng đúng phí đó. Chưa tính: miễn phí 30 ngày đầu, Voucher Xtra, đồng tài trợ mã ưu đãi, PiShip. Số ước tính được đánh dấu rõ trong các trang lãi.": "đ per order (tax included). Orders with fees in the file use exactly those fees. Not counted: the free first 30 days, Voucher Xtra, co-funded voucher codes, PiShip. Estimates are clearly marked on the profit pages.",
  "Chưa lưu được cài đặt: cần chạy migration": "Can't save settings: run migration",
  "Bật ước tính phí sàn": "Turn on fee estimate",
  "Loại shop": "Shop type",
  "Shop thường (không thuộc Shopee Mall)": "Regular shop (not Shopee Mall)",
  "Người bán mới (đăng sản phẩm đầu tiên từ 01/01 đến 31/05/2026): giảm Phí Cố Định 01/06 đến 31/08/2026": "New seller (first product listed from 01/01 to 31/05/2026): Fixed Fee discount from 01/06 to 31/08/2026",
  "Lưu cài đặt": "Save settings",
  "{0} sản phẩm đã chọn ngành, {1} chưa chọn.": "{0} products have a category, {1} don't.",
  "Sản phẩm chưa chọn ngành thì đơn của nó chưa được ước tính phí.": "Orders with products that have no category don't get a fee estimate yet.",
  "Ngành hàng tính phí": "Fee category",
  "Chưa chọn": "Not chosen",
  "Chọn ngành": "Choose category",
  "Đổi": "Change",
  "Bỏ": "Remove",
  "Bỏ ngành của {0}": "Remove the category of {0}",
  "Không có trong biểu phí loại shop này": "Not in this shop type's fee table",
  "Không lưu được cài đặt phí.": "Couldn't save the fee settings.",
  "Đã lưu cài đặt ước tính phí sàn.": "Fee estimate settings saved.",
  "Đã chọn ngành cho {0} sản phẩm.": "Category set for {0} products.",
  "Đã bỏ ngành hàng.": "Category removed.",

  // Hộp thoại chọn ngành
  "Chọn ngành hàng tính phí": "Choose the fee category",
  "Tìm ngành hàng": "Search categories",
  "Gõ tên ngành, ví dụ: tai nghe, áo thun, son môi…": "Type a category, e.g. earphones, t-shirt, lipstick…",
  "Dùng ngành này cho mọi sản phẩm chưa chọn ngành": "Use this category for every product without one",
  "Gõ vài chữ để tìm. Mức phí là Phí Cố Định theo biểu của Shopee, đã gồm thuế GTGT.": "Type a few letters to search. The rate is the Fixed Fee from Shopee's table, VAT included.",
  "Không thấy ngành nào khớp. Thử chữ ngắn hơn hoặc bỏ dấu.": "No category matches. Try shorter words or drop the accents.",
  "Không tìm được ngành hàng.": "Couldn't search categories.",

  // Ghi chú ở các trang lãi
  "đơn dùng phí sàn": "orders use a marketplace fee that is an",
  "ước tính": "estimate",
  "theo biểu phí Shopee vì file đơn hàng không có phí. Số thật nằm ở Báo cáo thu nhập của Shopee. Bật hoặc chỉnh ở trang": "based on Shopee's fee table because the order file has no fees. The real figures are in Shopee's Income Report. Turn it on or adjust it on the",
  "(ước tính)": "(estimate)",
  "Có phí sàn ước tính": "Includes an estimated marketplace fee",

  // API
  "Bạn không có quyền sửa cài đặt phí của workspace này": "You don't have permission to edit this workspace's fee settings",
  "Dữ liệu không hợp lệ": "Invalid data",
  "Ngành hàng \"{0}\" không có trong biểu phí của loại shop đã chọn.": "Category \"{0}\" is not in the fee table of the selected shop type.",
  "Cần chạy migration 0018_shopee_fee_estimate.sql trên Supabase trước khi lưu cài đặt phí.": "Run migration 0018_shopee_fee_estimate.sql on Supabase before saving fee settings.",
  "Đã đạt giới hạn 5.000 sản phẩm trong bảng ngành hàng.": "You've reached the limit of 5,000 products in the category table.",
  "Không lưu được, thử lại sau.": "Couldn't save, try again later.",
};
