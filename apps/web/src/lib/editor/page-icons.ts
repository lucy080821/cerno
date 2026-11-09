/**
 * Bộ icon cho trang (hiện ở thanh trang khi xem). Mỗi icon là vài đường path trên lưới 24x24, nét đơn,
 * dùng chung một kiểu vẽ (stroke 1.8, bo đầu) nên trông đều nhau. Chọn theo ngành để dùng được cho nhiều loại dashboard.
 * `key` được lưu trong `page.icon`; key lạ (bản cũ/mới hơn) rơi về icon mặc định `page`.
 */
export interface PageIcon {
  key: string;
  label: string;
  group: string;
  paths: string[];
}

/** Đường tròn tâm (cx,cy) bán kính r dưới dạng path, để mọi icon chỉ cần `d`. */
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const PAGE_ICONS: PageIcon[] = [
  // Chung
  { key: "page", label: "Trang", group: "Chung", paths: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5"] },
  { key: "home", label: "Tổng quan", group: "Chung", paths: ["M3 11l9-8 9 8", "M5 10v10h14V10", "M10 20v-6h4v6"] },
  { key: "table", label: "Bảng", group: "Chung", paths: ["M3 5h18v14H3z", "M3 10h18", "M9 10v9"] },
  { key: "list", label: "Danh sách", group: "Chung", paths: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"] },
  { key: "database", label: "Dữ liệu", group: "Chung", paths: ["M4 6c0 1.7 3.6 3 8 3s8-1.3 8-3-3.6-3-8-3-8 1.3-8 3z", "M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6", "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"] },
  { key: "settings", label: "Cài đặt", group: "Chung", paths: ["M4 7h10", "M18 7h2", "M4 17h2", "M10 17h10", "M14 5v4", "M6 15v4"] },
  { key: "star", label: "Nổi bật", group: "Chung", paths: ["M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"] },
  { key: "calendar", label: "Lịch", group: "Chung", paths: ["M4 6h16v14H4z", "M4 10h16", "M8 3v4", "M16 3v4"] },
  { key: "clock", label: "Thời gian", group: "Chung", paths: [circle(12, 12, 9), "M12 7v5l3 2"] },
  { key: "pin", label: "Địa điểm", group: "Chung", paths: ["M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z", circle(12, 10, 2)] },
  { key: "globe", label: "Toàn cầu", group: "Chung", paths: [circle(12, 12, 9), "M3 12h18", "M12 3c3 3 3 15 0 18", "M12 3c-3 3-3 15 0 18"] },
  { key: "shield", label: "Bảo mật", group: "Chung", paths: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"] },
  // Phân tích
  { key: "bar", label: "Biểu đồ cột", group: "Phân tích", paths: ["M3 21h18", "M6 21V11", "M12 21V4", "M18 21v-7"] },
  { key: "trend", label: "Xu hướng", group: "Phân tích", paths: ["M3 17l6-6 4 4 8-8", "M15 7h6v6"] },
  { key: "pie", label: "Tỷ trọng", group: "Phân tích", paths: ["M21 12A9 9 0 1 1 12 3v9z", "M15 3.5A9 9 0 0 1 20.5 9H15z"] },
  { key: "target", label: "Mục tiêu", group: "Phân tích", paths: [circle(12, 12, 9), circle(12, 12, 5), circle(12, 12, 1)] },
  { key: "pulse", label: "Hoạt động", group: "Phân tích", paths: ["M3 12h4l3-7 4 14 3-7h4"] },
  // Kinh doanh
  { key: "money", label: "Doanh thu", group: "Kinh doanh", paths: [circle(12, 12, 9), "M14.5 9.5A2.5 2 0 0 0 12 8c-1.4 0-2.5.9-2.5 2s1 1.8 2.5 2 2.5.9 2.5 2-1.1 2-2.5 2a2.5 2 0 0 1-2.5-1.5", "M12 6v2", "M12 16v2"] },
  { key: "cart", label: "Bán hàng", group: "Kinh doanh", paths: ["M3 4h2l2.5 11h10l2-8H6", circle(10, 20, 1), circle(17, 20, 1)] },
  { key: "users", label: "Khách hàng", group: "Kinh doanh", paths: ["M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20", circle(10, 7.5, 3.5), "M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3", "M15.5 4.2a3.5 3.5 0 0 1 0 6.6"] },
  { key: "user", label: "Cá nhân", group: "Kinh doanh", paths: ["M5 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1", circle(12, 7, 4)] },
  { key: "megaphone", label: "Marketing", group: "Kinh doanh", paths: ["M3 11v3h3l8 4V7L6 11z", "M17 9a4 4 0 0 1 0 6", "M6 14l1 5h3l-1-4"] },
  { key: "mail", label: "Email", group: "Kinh doanh", paths: ["M3 6h18v12H3z", "M3 7l9 6 9-6"] },
  { key: "video", label: "Video", group: "Kinh doanh", paths: ["M3 6h18v12H3z", "M10 9l5 3-5 3z"] },
  // Ngành
  { key: "bank", label: "Tài chính", group: "Theo ngành", paths: ["M3 10l9-6 9 6", "M5 10v8", "M9 10v8", "M15 10v8", "M19 10v8", "M3 21h18"] },
  { key: "building", label: "Bất động sản", group: "Theo ngành", paths: ["M5 21V4h9v17", "M14 9h5v12", "M3 21h18", "M8 8h3", "M8 12h3", "M8 16h3"] },
  { key: "heart", label: "Y tế", group: "Theo ngành", paths: ["M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"] },
  { key: "cap", label: "Giáo dục", group: "Theo ngành", paths: ["M2 9l10-5 10 5-10 5z", "M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"] },
  { key: "book", label: "Đào tạo", group: "Theo ngành", paths: ["M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z", "M4 21V5", "M9 7h6"] },
  { key: "box", label: "Kho hàng", group: "Theo ngành", paths: ["M21 8l-9-5-9 5v8l9 5 9-5z", "M3 8l9 5 9-5", "M12 13v8"] },
  { key: "truck", label: "Vận tải", group: "Theo ngành", paths: ["M3 6h11v10H3z", "M14 10h4l3 3v3h-7", circle(7, 18, 2), circle(17, 18, 2)] },
  { key: "factory", label: "Sản xuất", group: "Theo ngành", paths: ["M3 21V10l6 4v-4l6 4V6h3v15z", "M3 21h18"] },
  { key: "leaf", label: "Nông nghiệp", group: "Theo ngành", paths: ["M5 19c0-9 5-14 15-14 0 10-5 15-14 15z", "M5 19l8-8"] },
  { key: "bolt", label: "Năng lượng", group: "Theo ngành", paths: ["M13 2L4 14h7l-1 8 9-12h-7z"] },
  { key: "plane", label: "Du lịch", group: "Theo ngành", paths: ["M21 3L3 10l7 3 3 7z", "M10 13L21 3"] },
  { key: "cup", label: "Ăn uống", group: "Theo ngành", paths: ["M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z", "M17 10h2a2 2 0 0 1 0 4h-2", "M8 3v2", "M12 3v2"] },
  { key: "code", label: "Công nghệ", group: "Theo ngành", paths: ["M8 8l-5 4 5 4", "M16 8l5 4-5 4", "M14 5l-4 14"] },
];

const BY_KEY = new Map(PAGE_ICONS.map((i) => [i.key, i]));

/** Icon theo key; key rỗng hoặc lạ → icon mặc định "page". */
export const getPageIcon = (key: string | undefined): PageIcon => BY_KEY.get(key ?? "") ?? PAGE_ICONS[0];
