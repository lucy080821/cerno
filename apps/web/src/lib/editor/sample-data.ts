import type { DataSource } from "@dashboard/schema";
import type { Row } from "@dashboard/chart-engine";
import { cachedRows, withCalculatedColumns } from "./data-store";

export const SAMPLE_SOURCE_ID = "sample";

export const SAMPLE_SOURCE: DataSource = {
  id: SAMPLE_SOURCE_ID,
  type: "sample",
  name: "Dữ liệu mẫu bán hàng",
  columns: [
    { name: "Ngày", type: "date" },
    { name: "Tháng", type: "string" },
    { name: "Khu vực", type: "string" },
    { name: "Kênh", type: "string" },
    { name: "Doanh thu", type: "number", unit: "đồng" },
    { name: "Đơn hàng", type: "number", unit: "đơn" },
    { name: "Lượt truy cập", type: "number", unit: "lượt" },
  ],
};

/** PRNG có seed để dữ liệu mẫu giống nhau giữa các lần tải (tránh lệch hydration). */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate(): Row[] {
  const rand = mulberry32(20251107);
  const regions: Array<[string, number]> = [["Miền Bắc", 1.2], ["Miền Trung", 0.7], ["Miền Nam", 1.5]];
  const channels: Array<[string, number]> = [["Organic", 1], ["Quảng cáo", 0.8], ["Giới thiệu", 0.5]];
  const rows: Row[] = [];
  for (let m = 0; m < 12; m++) {
    for (const [region, rf] of regions) {
      for (const [channel, cf] of channels) {
        const seasonal = 1 + 0.18 * Math.sin((m / 12) * Math.PI * 2 - 1);
        const base = (800 + m * 55) * rf * cf * seasonal * (0.88 + rand() * 0.24);
        const revenue = Math.round(base * 12);
        const orders = Math.round(revenue / (170 + rand() * 50));
        const visitors = Math.round(orders * (16 + rand() * 9));
        // Mỗi dòng rơi vào một ngày khác nhau trong tháng (1–28) để lọc khoảng ngày có ý nghĩa.
        const day = 1 + ((rows.length * 7) % 28);
        rows.push({
          "Ngày": `2025-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          "Tháng": `T${m + 1}`,
          "Khu vực": region,
          "Kênh": channel,
          "Doanh thu": revenue,
          "Đơn hàng": orders,
          "Lượt truy cập": visitors,
        });
      }
    }
  }
  return rows;
}

export const SAMPLE_ROWS: Row[] = generate();

const NO_ROWS: Row[] = [];

/**
 * Điểm truy cập dữ liệu duy nhất của editor: dữ liệu mẫu, hoặc bản sao Google Sheets đã tải vào `data-store`.
 * Không reactive: component cần gọi thêm `useDataVersion()` và đưa vào dependency của useMemo.
 * LƯU Ý: nguồn LỚN (> LOCAL_ROW_LIMIT dòng) chỉ có ~500 dòng mẫu ở đây. Chỉ dùng cho việc đoán kiểu cột/xem thử; số liệu thật
 * của chart/bảng/bộ lọc phải lấy qua truy vấn server (lib/editor/remote-query.ts), không được tính từ `getRows`.
 */
export function getRows(sourceId: string): Row[] {
  return withCalculatedColumns(sourceId, getRawRows(sourceId));
}

/** Dòng gốc, chưa thêm cột tính toán (dùng khi cần xem thử một công thức chưa lưu). */
export function getRawRows(sourceId: string): Row[] {
  if (sourceId === SAMPLE_SOURCE_ID) return SAMPLE_ROWS;
  return cachedRows(sourceId) ?? NO_ROWS;
}
