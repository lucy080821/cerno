import type { Channel, InputField } from "./canonical";

/**
 * Cách mỗi nguồn gọi tên cột. Tên đã chuẩn hoá (bỏ dấu, chữ thường, ký tự lạ thành dấu cách, xem `normalizeText`).
 * Thứ tự trong mảng là thứ tự ưu tiên: cột khớp từ đầu danh sách thắng.
 *
 * LƯU Ý: tên cột của Shopee/TikTok Shop được ghi theo hiểu biết về file xuất chuẩn, chưa đối chiếu với file thật của từng
 * shop. Sàn có thể đổi tên cột, nên màn hình nhập luôn cho người dùng xem và sửa ánh xạ trước khi lưu.
 */
export type Synonyms = Partial<Record<InputField, string[]>>;

export interface Profile {
  id: "shopee" | "tiktok" | "generic";
  /** Kênh mặc định; "generic" để người dùng tự chọn. */
  channel: Channel | null;
  label: string;
  /** Nhận ra đúng file của sàn này khi MỌI nhóm trong `signature` có ít nhất một tên cột khớp. */
  signature: string[][];
  synonyms: Synonyms;
  /** Trường được phép cộng nhiều cột (các loại phí). */
  sumFields: InputField[];
}

export const SHOPEE: Profile = {
  id: "shopee",
  channel: "Shopee",
  label: "Shopee (báo cáo đơn hàng)",
  signature: [["ma don hang"], ["trang thai don hang"], ["ngay dat hang"]],
  synonyms: {
    orderId: ["ma don hang"],
    date: ["ngay dat hang", "thoi gian dat hang"],
    status: ["trang thai don hang"],
    sku: ["sku phan loai hang", "sku san pham", "ma sku"],
    product: ["ten san pham"],
    variant: ["ten phan loai hang", "phan loai hang", "ten variation"],
    quantity: ["so luong"],
    revenue: ["tong gia ban san pham", "tong gia ban"],
    unitPrice: ["gia uu dai", "gia goc"],
    platformFee: ["phi co dinh", "phi dich vu", "phi thanh toan"],
    province: ["tinh thanh pho"],
    payment: ["phuong thuc thanh toan"],
  },
  sumFields: ["platformFee"],
};

export const TIKTOK: Profile = {
  id: "tiktok",
  channel: "TikTok Shop",
  label: "TikTok Shop (xuất đơn hàng)",
  signature: [["order id"], ["order status"], ["created time", "order created time"]],
  synonyms: {
    orderId: ["order id"],
    date: ["created time", "order created time"],
    status: ["order status"],
    sku: ["seller sku", "sku id"],
    product: ["product name"],
    variant: ["variation"],
    quantity: ["quantity"],
    revenue: ["sku subtotal after discount"],
    unitPrice: ["sku unit original price"],
    province: ["province", "city"],
    payment: ["payment method"],
  },
  sumFields: [],
};

/** File tự ghi hoặc của sàn khác: tên cột thường gặp trong sổ bán hàng của người Việt (cả tiếng Anh). */
export const GENERIC: Profile = {
  id: "generic",
  channel: null,
  label: "File khác (tự chọn cột)",
  signature: [],
  synonyms: {
    orderId: ["ma don hang", "ma don", "so don", "order id", "order", "ma hd", "so hoa don"],
    date: ["ngay dat hang", "ngay dat", "ngay ban", "ngay", "thoi gian", "date", "created time"],
    status: ["trang thai don hang", "trang thai", "order status", "status"],
    sku: ["sku", "ma sku", "ma sp", "ma san pham", "ma hang", "seller sku"],
    product: ["ten san pham", "san pham", "ten hang", "mat hang", "hang hoa", "product name", "product"],
    variant: ["phan loai hang", "phan loai", "variation", "size", "mau"],
    quantity: ["so luong", "sl", "quantity", "qty"],
    revenue: ["thanh tien", "doanh thu", "tong tien", "tong gia tri", "tien hang", "amount", "total"],
    unitPrice: ["don gia", "gia ban", "gia", "price"],
    platformFee: ["phi san", "phi"],
    province: ["tinh thanh pho", "tinh thanh", "tinh", "thanh pho", "province", "city"],
    payment: ["phuong thuc thanh toan", "hinh thuc thanh toan", "thanh toan", "payment method"],
  },
  sumFields: ["platformFee"],
};

export const PROFILES: Profile[] = [SHOPEE, TIKTOK, GENERIC];
