import { NAV, type NavItem } from "@/lib/shell/nav";

/**
 * Danh sách trang và hành động mà ô tìm kiếm gợi ý. `label` là chữ hiện ra (có bản dịch tiếng Anh ở `lib/i18n/en/search.ts`);
 * `keywords` chỉ để KHỚP, không hiển thị: viết không dấu, gồm từ đồng nghĩa và từ tiếng Anh để gõ kiểu nào cũng ra.
 * Hành động ở đây chỉ ĐI TỚI nơi thao tác (không tự làm thay người dùng).
 */
export type SearchKind = "page" | "action";

export interface SearchEntry {
  id: string;
  kind: SearchKind;
  label: string;
  hint?: string;
  href?: string;
  /** Hành động đặc biệt không phải điều hướng. */
  run?: "toggle-lang" | "sign-out";
  keywords: string;
}

/** Từ khoá thêm cho từng trang trong thanh bên (không dấu, có từ đồng nghĩa và tiếng Anh). */
const PAGE_KEYWORDS: Record<string, { hint: string; keywords: string }> = {
  overview: { hint: "Lãi thật, đơn lỗ và việc nên làm trước", keywords: "tong quan trang chu home overview kpi chi so chinh" },
  sources: { hint: "Tải file đơn hàng, nối Google Sheet", keywords: "nguon du lieu data source google sheet excel csv tai file import upload ket noi dong bo" },
  orders: { hint: "Lãi từng đơn, đơn lỗ, đơn hoàn", keywords: "don hang order ma don lai tung don don lo don hoan tra cuu" },
  products: { hint: "Giá vốn, ngành hàng tính phí sàn", keywords: "san pham gia von sku nganh hang cost cogs hoa von phi san" },
  costs: { hint: "Giá vốn, phí sàn, quảng cáo, vận chuyển", keywords: "chi phi cost phi san quang cao ads van chuyen ship shipping fee" },
  dashboards: { hint: "Danh sách và editor dashboard", keywords: "dashboard bieu do chart bao cao editor thiet ke tao dashboard" },
  profit: { hint: "Tiền đi đâu, lãi theo kênh và sản phẩm", keywords: "lai lo loi nhuan profit loss thac nuoc bien lai kenh san pham" },
  returns: { hint: "Tỷ lệ hủy, hoàn trả, phí bị thu", keywords: "hoan huy tra hang return cancel refund ty le huy ty le hoan" },
  ai: { hint: "Trò chuyện với AI về số liệu của bạn", keywords: "hoi ai tro ly chat ai assistant phan tich hoi dap hoi" },
  todos: { hint: "Việc nên làm để tăng lãi", keywords: "viec can lam todo goi y nhac viec hanh dong" },
  alerts: { hint: "Báo khi số liệu vượt ngưỡng hoặc bất thường", keywords: "canh bao alert thong bao nguong bat thuong notification" },
  reports: { hint: "Báo cáo gửi email hằng ngày, tuần, tháng", keywords: "bao cao dinh ky email report hang ngay hang tuan hang thang gui mail" },
  templates: { hint: "Tạo dashboard nhanh từ mẫu theo ngành", keywords: "mau dashboard template theo nganh thu vien mau" },
  sharing: { hint: "Chia sẻ link, mời người, nhúng website", keywords: "chia se nhung embed iframe link moi nguoi share quyen" },
};

const EXTRA_PAGES: SearchEntry[] = [
  { id: "page:account", kind: "page", label: "Tài khoản", hint: "Thông tin, xóa tài khoản và dữ liệu", href: "/account", keywords: "tai khoan account xoa tai khoan dang xuat profile cai dat settings" },
  { id: "page:upgrade", kind: "page", label: "Gói và nâng cấp", hint: "So sánh gói miễn phí và trả phí", href: "/upgrade", keywords: "goi nang cap upgrade plan tra phi mien phi pricing gia" },
  { id: "page:privacy", kind: "page", label: "Chính sách quyền riêng tư", href: "/privacy", keywords: "chinh sach quyen rieng tu privacy du lieu bao mat" },
  { id: "page:terms", kind: "page", label: "Điều khoản sử dụng", href: "/terms", keywords: "dieu khoan su dung terms dieu kien" },
];

const ACTIONS: SearchEntry[] = [
  { id: "act:import-orders", kind: "action", label: "Tải file đơn hàng Shopee, TikTok Shop", hint: "Đi tới Nguồn dữ liệu", href: "/sources", keywords: "tai file don hang shopee tiktok excel csv xlsx import upload nhap don" },
  { id: "act:connect-sheet", kind: "action", label: "Nối Google Sheet đơn hàng", hint: "Đi tới Nguồn dữ liệu", href: "/sources", keywords: "noi google sheet don hang ket noi sheet dong bo connect" },
  { id: "act:costs", kind: "action", label: "Nhập giá vốn sản phẩm", hint: "Đi tới Sản phẩm và giá vốn", href: "/products", keywords: "nhap gia von san pham cost cogs dan tu excel sku" },
  { id: "act:category", kind: "action", label: "Chọn ngành hàng tính phí sàn", hint: "Đi tới Sản phẩm và giá vốn", href: "/products", keywords: "nganh hang phi san uoc tinh phi co dinh category fee shopee tiktok" },
  { id: "act:ads", kind: "action", label: "Nhập chi phí quảng cáo", hint: "Đi tới Chi phí", href: "/costs", keywords: "chi phi quang cao ads facebook shopee ads tiktok ads nhap file quang cao" },
  { id: "act:ship", kind: "action", label: "Nhập phí vận chuyển shop chịu", hint: "Đi tới Chi phí", href: "/costs", keywords: "phi van chuyen ship shipping shop chiu van chuyen uoc tinh" },
  { id: "act:manual-fee", kind: "action", label: "Nhập phí sàn Lazada, Tiki", hint: "Đi tới Chi phí", href: "/costs", keywords: "phi san lazada tiki tu nhap hoa hong phi thanh toan" },
  { id: "act:template", kind: "action", label: "Tạo dashboard từ mẫu theo ngành", hint: "Đi tới Mẫu dashboard", href: "/templates", keywords: "tao dashboard tu mau template theo nganh ban hang thuong mai dien tu" },
  { id: "act:new-dashboard", kind: "action", label: "Tạo dashboard trống", hint: "Đi tới Dashboard", href: "/dashboards", keywords: "tao dashboard moi trong new dashboard blank" },
  { id: "act:alert", kind: "action", label: "Tạo cảnh báo khi số liệu bất thường", hint: "Đi tới Cảnh báo", href: "/alerts", keywords: "tao canh bao nguong bat thuong bao khi alert doanh thu giam" },
  { id: "act:report", kind: "action", label: "Đặt báo cáo gửi email định kỳ", hint: "Đi tới Báo cáo định kỳ", href: "/reports", keywords: "dat bao cao email dinh ky hang tuan hang ngay schedule report" },
  { id: "act:share", kind: "action", label: "Mời người cùng xem dashboard", hint: "Đi tới Chia sẻ và nhúng", href: "/sharing", keywords: "moi nguoi cung xem chia se dashboard link nhung embed invite" },
  { id: "act:loss", kind: "action", label: "Xem các đơn đang lỗ", hint: "Đi tới Đơn hàng", href: "/orders?filter=loss", keywords: "don lo don dang lo don thua lo loss orders" },
  { id: "act:missing", kind: "action", label: "Xem đơn thiếu giá vốn", hint: "Đi tới Đơn hàng", href: "/orders?filter=missing", keywords: "don thieu gia von chua nhap gia von missing cost" },
  { id: "act:returns", kind: "action", label: "Xem đơn hoàn trả", hint: "Đi tới Đơn hàng", href: "/orders?filter=return", keywords: "don hoan tra tra hang hoan tien return refund" },
  { id: "act:thin", kind: "action", label: "Xem đơn lãi mỏng", hint: "Đi tới Đơn hàng", href: "/orders?filter=thin", keywords: "don lai mong bien lai thap thin margin" },
  { id: "act:lang", kind: "action", label: "Đổi ngôn ngữ Việt / English", run: "toggle-lang", keywords: "doi ngon ngu tieng viet tieng anh english vietnamese language lang vi en" },
  { id: "act:signout", kind: "action", label: "Đăng xuất", run: "sign-out", keywords: "dang xuat thoat logout sign out" },
];

export const SEARCH_ENTRIES: SearchEntry[] = [
  ...NAV.filter((n): n is NavItem => "href" in n).map<SearchEntry>((n) => ({
    id: `page:${n.key}`,
    kind: "page",
    label: n.label,
    hint: PAGE_KEYWORDS[n.key]?.hint,
    href: n.href,
    keywords: PAGE_KEYWORDS[n.key]?.keywords ?? "",
  })),
  ...EXTRA_PAGES,
  ...ACTIONS,
];
