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
    // "Phí Thanh Toán" được Shopee đổi tên thành "Phí Xử Lý Giao Dịch" từ 24/04/2026; "Phí Hạ Tầng" (3.000đ/đơn) có từ 01/07/2025.
    platformFee: ["phi co dinh", "phi dich vu", "phi thanh toan", "phi xu ly giao dich", "phi ha tang"],
    province: ["tinh thanh pho"],
    payment: ["phuong thuc thanh toan"],
    shippingFee: ["phi van chuyen ma nguoi mua tra"],
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
    discount: ["sku seller discount"],
    shippingFee: ["shipping fee after discount"],
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
    discount: ["giam gia", "chiet khau", "khuyen mai", "discount"],
    shippingFee: ["phi van chuyen khach tra", "phi ship khach tra", "phi van chuyen nguoi mua tra"],
    cost: ["gia von", "chi phi gia von", "tong gia von", "cogs"],
    adCost: ["chi phi quang cao", "phi quang cao", "quang cao", "ad cost", "ads cost"],
  },
  sumFields: ["platformFee"],
};

/**
 * Nhận diện linh hoạt khi tên cột không khớp từng chữ (vd "Phí sàn Shopee", "Trạng thái đơn", "Kênh thanh toán").
 * Chỉ chạy cho trường CHƯA có cột nào khớp chính xác, trên tên đã chuẩn hoá (`normalizeText`). Mẫu viết chặt: neo đầu và cuối,
 * chỉ cho thêm chữ ở đúng chỗ an toàn, để không nhận nhầm (vd "Phí vận chuyển" không phải phí sàn, "Trạng thái trả hàng" không phải
 * trạng thái đơn). `FUZZY_DENY` loại thêm các từ khoá nguy hiểm.
 */
export const FUZZY: Partial<Record<InputField, RegExp[]>> = {
  orderId: [/^(ma|so) (don|don hang|hoa don)( [a-z0-9 ]+)?$/, /^order (id|no|number)( [a-z0-9 ]+)?$/],
  date: [/^(ngay|thoi gian|ngay gio) (dat|tao|len)( hang| don| don hang)?( [a-z0-9 ]+)?$/, /^ngay (ban|mua)( hang)?$/, /^(order )?(created|create) (time|date)$/],
  status: [/^trang thai( don( hang)?)?( (cua )?(shopee|tiktok|san|goc|hien tai))?$/, /^order status( [a-z]+)?$/],
  sku: [/^(ma|sku)( san pham| sp| hang| hang hoa)( [a-z0-9 ]+)?$/, /^seller sku( [a-z0-9 ]+)?$/],
  product: [/^ten (san pham|hang|mat hang|hang hoa)( [a-z0-9 ]+)?$/, /^product name( [a-z0-9 ]+)?$/],
  variant: [/^(ten )?phan loai( hang)?( [a-z0-9 ]+)?$/],
  quantity: [/^so luong( [a-z0-9 ]+)?$/],
  revenue: [/^(thanh tien|doanh thu|doanh so|tong tien hang|tien hang)( (hang hoa|ban hang|san pham|dong|truoc giam gia|sau giam gia))?$/, /^tong gia ban( san pham)?$/],
  unitPrice: [/^(don gia|gia ban|gia ban le|gia uu dai|gia khuyen mai)( [a-z0-9 ]+)?$/],
  platformFee: [/^phi (san|co dinh|dich vu|thanh toan|giao dich|hoa hong|nen tang|xu ly giao dich|ha tang)( [a-z0-9 ]+)?$/, /^(commission|transaction|service|payment) fee( [a-z0-9 ]+)?$/],
  province: [/^tinh thanh( pho)?( [a-z0-9 ]+)?$/, /^thanh pho( [a-z0-9 ]+)?$/],
  payment: [/^(kenh|hinh thuc|phuong thuc|cach) thanh toan( [a-z0-9 ]+)?$/, /^payment( method| channel)?$/],
  discount: [/^(giam gia|chiet khau|khuyen mai)( [a-z0-9 ]+)?$/],
  shippingFee: [/^phi (van chuyen|ship|giao hang) (khach|nguoi mua|kh)( tra| chiu| thanh toan)?( [a-z0-9 ]+)?$/],
  cost: [/^(chi phi )?gia von( [a-z0-9 ]+)?$/, /^tong gia von$/, /^cogs$/],
  adCost: [/^(chi phi|phi) (quang cao|ads|marketing)( [a-z0-9 ]+)?$/],
};
export const FUZZY_DENY: Partial<Record<InputField, RegExp>> = {
  orderId: /(van chuyen|van don|doi tac)/,
  date: /(giao|gui|hoan thanh|thanh toan|du kien|huy)/,
  quantity: /(tra|hoan|ton|kho|returned|huy)/,
  unitPrice: /(nhap|von)/,
  platformFee: /(van chuyen|ship|giao hang|quang cao|tai tro)/,
  discount: /(phan tram|ty le)/,
};

export const PROFILES: Profile[] = [SHOPEE, TIKTOK, GENERIC];
