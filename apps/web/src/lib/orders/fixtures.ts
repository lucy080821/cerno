import type { RawTable } from "./files";

/**
 * Bảng mô phỏng file xuất của Shopee và TikTok Shop, dựng theo cấu trúc file chuẩn (mỗi DÒNG SẢN PHẨM một dòng, giá trị cấp đơn
 * lặp ở mọi dòng của đơn). Không phải file thật: tên cột cần đối chiếu lại với file xuất của từng shop.
 * Các cột thông tin người mua có giá trị "SECRET-..." để test khẳng định chúng không bao giờ lọt vào kết quả.
 */
export const SHOPEE_HEADER = [
  "Mã đơn hàng", "Trạng Thái Đơn Hàng", "Lý do hủy", "Ngày đặt hàng", "Mã vận đơn",
  "SKU sản phẩm", "Tên sản phẩm", "SKU phân loại hàng", "Tên phân loại hàng",
  "Giá gốc", "Giá ưu đãi", "Số lượng", "Tổng giá bán (sản phẩm)", "Tổng giá trị đơn hàng (VND)",
  "Phí cố định", "Phí Dịch Vụ", "Phí Thanh Toán",
  "Tỉnh/Thành phố", "Phương thức thanh toán", "Tên Người nhận", "Số điện thoại", "Địa chỉ nhận hàng",
];

const shopeeLine = (o: Partial<Record<string, string | number>>): (string | number)[] => {
  const d: Record<string, string | number> = {
    "Mã đơn hàng": "", "Trạng Thái Đơn Hàng": "Hoàn thành", "Lý do hủy": "", "Ngày đặt hàng": "2025-09-05 14:30",
    "Mã vận đơn": "SPXVN0001", "SKU sản phẩm": "ÁO-01", "Tên sản phẩm": "Áo thun nam", "SKU phân loại hàng": "ÁO-01-M",
    "Tên phân loại hàng": "Size M", "Giá gốc": 150000, "Giá ưu đãi": 120000, "Số lượng": 1, "Tổng giá bán (sản phẩm)": 120000,
    "Tổng giá trị đơn hàng (VND)": 120000, "Phí cố định": 6000, "Phí Dịch Vụ": 6000, "Phí Thanh Toán": 3000,
    "Tỉnh/Thành phố": "TP. Hồ Chí Minh", "Phương thức thanh toán": "Thanh toán khi nhận hàng",
    "Tên Người nhận": "SECRET-NAME", "Số điện thoại": "SECRET-PHONE", "Địa chỉ nhận hàng": "SECRET-ADDRESS",
    ...o,
  };
  return SHOPEE_HEADER.map((h) => d[h]);
};

export const SHOPEE_TABLE: RawTable = [
  SHOPEE_HEADER,
  // Đơn A: hai dòng sản phẩm, phí và tổng đơn lặp ở cả hai dòng.
  shopeeLine({ "Mã đơn hàng": "A1", "Tổng giá trị đơn hàng (VND)": 320000 }),
  shopeeLine({ "Mã đơn hàng": "A1", "SKU sản phẩm": "QUẦN-02", "Tên sản phẩm": "Quần jean", "SKU phân loại hàng": "QUẦN-02-30", "Tên phân loại hàng": "Size 30", "Giá ưu đãi": 200000, "Tổng giá bán (sản phẩm)": 200000, "Tổng giá trị đơn hàng (VND)": 320000 }),
  // Đơn B: đã hủy.
  shopeeLine({ "Mã đơn hàng": "B2", "Trạng Thái Đơn Hàng": "Đã hủy", "Lý do hủy": "Người mua đổi ý", "Ngày đặt hàng": "2025-09-06 09:00", "Tỉnh/Thành phố": "Hà Nội" }),
  // Đơn C: đang giao, mua 2 cái.
  shopeeLine({ "Mã đơn hàng": "C3", "Trạng Thái Đơn Hàng": "Đang giao", "Ngày đặt hàng": "2025-09-07 20:15", "Số lượng": 2, "Tổng giá bán (sản phẩm)": 240000, "Tỉnh/Thành phố": "Đà Nẵng", "Phương thức thanh toán": "Ví ShopeePay" }),
];

export const TIKTOK_HEADER = [
  "Order ID", "Order Status", "Order Substatus", "Cancelation/Return Type", "Seller SKU", "Product Name", "Variation", "Quantity",
  "SKU Unit Original Price", "SKU Subtotal Before Discount", "SKU Platform Discount", "SKU Seller Discount", "SKU Subtotal After Discount",
  "Shipping Fee After Discount", "Order Amount", "Created Time", "Paid Time", "Province", "Payment Method",
  "Buyer Username", "Recipient", "Phone #",
];

const tiktokLine = (o: Partial<Record<string, string | number>>): (string | number)[] => {
  const d: Record<string, string | number> = {
    "Order ID": "", "Order Status": "Completed", "Order Substatus": "", "Cancelation/Return Type": "", "Seller SKU": "SP-01",
    "Product Name": "Son môi", "Variation": "Đỏ", "Quantity": 1, "SKU Unit Original Price": 100000, "SKU Subtotal Before Discount": 100000,
    "SKU Platform Discount": 0, "SKU Seller Discount": 10000, "SKU Subtotal After Discount": 90000, "Shipping Fee After Discount": 0,
    "Order Amount": 90000, "Created Time": "07/09/2025 02:30:15 PM", "Paid Time": "07/09/2025 02:31:00 PM", "Province": "Cần Thơ",
    "Payment Method": "Cash on delivery", "Buyer Username": "SECRET-USER", "Recipient": "SECRET-NAME", "Phone #": "SECRET-PHONE",
    ...o,
  };
  return TIKTOK_HEADER.map((h) => d[h]);
};

export const TIKTOK_TABLE: RawTable = [
  TIKTOK_HEADER,
  // ID dài có tab đầu dòng, đúng kiểu TikTok hay xuất để Excel không đổi sang dạng số khoa học.
  tiktokLine({ "Order ID": "\t576460752303423488" }),
  tiktokLine({ "Order ID": "\t576460752303423489", "Order Status": "Cancelled", "Created Time": "25/09/2025 10:00:00 AM" }),
];
