import Link from "next/link";
import { ConnectSheet } from "../dashboards/ConnectSheet";
import { ConnectOrderSheet } from "../dashboards/ConnectOrderSheet";
import { ImportOrders } from "../dashboards/ImportOrders";
import { AUTO_SYNC_MINUTES } from "@/lib/google/constants";
import { MAX_ROWS } from "@/lib/google/sheet-data";
import { MAX_SOURCES_PER_WORKSPACE } from "@/lib/limits";
import { MAX_UPLOAD_BYTES } from "@/lib/orders/canonical";
import { vnDateTime } from "@/lib/format/vn-time";
import { SourcesTable } from "./SourcesTable";
import type { OrderSheetRow, SourceRow } from "./types";
import s from "./sources.module.css";

const ICON = {
  file: "M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6",
  sheet: "M4 4h16v16H4zM4 10h16M10 4v16",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
};

function Glyph({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}


const nf = new Intl.NumberFormat("vi-VN");

/** Giao diện trang Nguồn dữ liệu: tổng quan, danh sách nguồn đã kết nối và các cách thêm nguồn mới (không truy vấn gì, nhận dữ liệu đã đọc). */
export function SourcesView({ sources, orderSheets, apiKey, appId }: { sources: SourceRow[]; orderSheets: OrderSheetRow[]; apiKey: string; appId: string }) {
  // Số dòng chỉ cộng các nguồn lưu trong hệ thống: Sheet đơn hàng ghi vào nguồn "Đơn hàng đa kênh" nên cộng thêm sẽ bị đếm hai lần.
  const totalRows = sources.reduce((n, x) => n + (x.row_count ?? 0), 0);
  const stamps = [...sources.map((x) => x.last_synced_at), ...orderSheets.map((x) => x.last_synced_at)].filter((x): x is string => !!x).sort();
  const latest = stamps.length ? stamps[stamps.length - 1] : null;
  const attention = sources.filter((x) => x.last_error).length + orderSheets.filter((x) => x.last_error).length;
  const used = Math.min(100, Math.round((sources.length / MAX_SOURCES_PER_WORKSPACE) * 100));

  return (
    <div className={s.page}>
        <header className={s.head}>
          <div>
            <h2 className={s.title}>Nguồn dữ liệu</h2>
            <p className={s.lead}>Quản lý nơi Cerno lấy số liệu cho dashboard và các trang lãi lỗ. Dữ liệu được sao về hệ thống, biểu đồ không gọi Google mỗi lần xem.</p>
          </div>
        </header>

        <section className={s.stats} aria-label="Tổng quan">
          <div className={s.stat}>
            <span className={s.statLabel}>Nguồn đã kết nối</span>
            <b className={s.statValue}>{sources.length}<small>{` / ${MAX_SOURCES_PER_WORKSPACE}`}</small></b>
            <span className={s.meter} aria-hidden><i style={{ width: `${used}%` }} /></span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>Tổng số dòng dữ liệu</span>
            <b className={s.statValue}>{nf.format(totalRows)}</b>
            <span className={s.statNote}>{`${orderSheets.length} Sheet đơn hàng đang nối`}</span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>Cập nhật gần nhất</span>
            <b className={`${s.statValue} ${s.statSmall}`}>{vnDateTime(latest)}</b>
            <span className={s.statNote}>Giờ Việt Nam</span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>Cần chú ý</span>
            <b className={`${s.statValue} ${attention > 0 ? s.statWarn : ""}`}>{attention}</b>
            <span className={s.statNote}>{attention > 0 ? "Nguồn đang báo lỗi đồng bộ" : "Không có lỗi"}</span>
          </div>
        </section>

        <section className={s.panel}>
          <div className={s.panelHead}>
            <h3>Danh sách nguồn</h3>
            <span className={s.panelNote}>{`${sources.length + orderSheets.length} mục`}</span>
          </div>
          <SourcesTable sources={sources} orderSheets={orderSheets} />
        </section>

        <section className={s.panel}>
          <div className={s.panelHead}>
            <h3>Thêm nguồn mới</h3>
            <span className={s.panelNote}>Chọn cách kết nối phù hợp với dữ liệu của bạn</span>
          </div>
          <div className={s.connectors}>
            <div className={s.connector}>
              <div className={s.cHead}><span className={s.cIcon}><Glyph d={ICON.file} /></span><span className={s.cTag}>Tải thủ công</span></div>
              <h4>File đơn hàng Shopee, TikTok Shop</h4>
              <p>Tải file Excel hoặc CSV xuất từ sàn. Cerno tự nhận diện cột, gộp mọi kênh về một bảng và dùng cho các trang lãi lỗ.</p>
              <dl className={s.cMeta}><dt>Định dạng</dt><dd>{`.xlsx, .csv (tối đa ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB)`}</dd></dl>
              <div className={s.cAction}><ImportOrders label="Tải file đơn hàng" /></div>
            </div>
            <div className={s.connector}>
              <div className={s.cHead}><span className={s.cIcon}><Glyph d={ICON.link} /></span><span className={`${s.cTag} ${s.cTagAuto}`}>Tự động cập nhật</span></div>
              <h4>Google Sheet đơn hàng</h4>
              <p>Nối bảng đơn hàng của từng sàn trong Google Sheets. Thêm dòng mới vào Sheet, Cerno tự đọc lại và cập nhật các trang lãi lỗ.</p>
              <dl className={s.cMeta}><dt>Định kỳ</dt><dd>{`Mỗi ${AUTO_SYNC_MINUTES / 60} giờ hoặc bấm Cập nhật`}</dd></dl>
              <div className={s.cAction}><ConnectOrderSheet apiKey={apiKey} appId={appId} /></div>
            </div>
            <div className={s.connector}>
              <div className={s.cHead}><span className={s.cIcon}><Glyph d={ICON.sheet} /></span><span className={`${s.cTag} ${s.cTagAuto}`}>Tự động cập nhật</span></div>
              <h4>Google Sheet dữ liệu bảng</h4>
              <p>Dùng bất kỳ bảng nào trong Google Sheets làm dữ liệu cho biểu đồ. Dòng đầu của tab là tên cột.</p>
              <dl className={s.cMeta}><dt>Giới hạn</dt><dd>{`Tối đa ${nf.format(MAX_ROWS)} dòng mỗi nguồn`}</dd></dl>
              <div className={s.cAction}><ConnectSheet apiKey={apiKey} appId={appId} /></div>
            </div>
          </div>
        </section>

        <footer className={s.foot}>
          <Link href="/privacy">Quyền riêng tư</Link> · <Link href="/terms">Điều khoản</Link>
        </footer>
    </div>
  );
}
