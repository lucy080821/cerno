import type { Metadata } from "next";
import Link from "next/link";
import { BRAND, MAX_PAGES } from "@dashboard/schema";
import { HeroScene } from "@/components/HeroScene";
import { RevealController } from "@/components/landing/RevealController";
import { DemoSlot } from "@/components/landing/DemoSlot";
import { CountUp } from "@/components/landing/CountUp";
import { FlowDiagram } from "@/components/landing/FlowDiagram";
import { CircuitBackground } from "@/components/landing/CircuitBackground";
import { LangSwitch } from "@/components/i18n/LangSwitch";
import { Brand } from "@/components/Brand";
import { site } from "@/lib/site";
import { jsonLd, siteUrl } from "@/lib/seo";
import { AUTO_SYNC_MINUTES } from "@/lib/google/constants";
import { MAX_COLUMNS, MAX_ROWS } from "@/lib/google/sheet-data";
import { MAX_DASHBOARDS_PER_WORKSPACE, MAX_SOURCES_PER_WORKSPACE } from "@/lib/limits";
import s from "./landing.module.css";

export const metadata: Metadata = {
  title: `${site.name} | Tạo dashboard từ Google Sheets, đặt chart tự do`,
  description:
    "Tạo dashboard miễn phí, không cần biết lập trình, không cần là dân data: kết nối Google Sheets, kéo-thả 13 loại biểu đồ, trợ lý AI, chia sẻ bằng link hoặc nhúng vào website.",
  alternates: { canonical: "/" },
};

const nf = new Intl.NumberFormat("vi-VN");
const hours = AUTO_SYNC_MINUTES / 60;

// ---------------------------------------------------------------------------------------------
// Nội dung. Mọi con số lấy từ hằng số thật của app để trang này không hứa quá những gì app làm được.

const FOR_EVERYONE = [
  {
    title: "Chọn, không phải viết",
    body: "Chọn cột dữ liệu và kiểu tính (tổng, trung bình, đếm...) bằng ô chọn. Không có dòng code, không có câu truy vấn.",
  },
  {
    title: "Nói tiếng Việt với trợ lý AI",
    body: 'Gõ "thêm biểu đồ doanh thu theo tháng" là có ngay. Không vừa ý thì hoàn tác một cú bấm.',
  },
  {
    title: "Bắt đầu từ dashboard mẫu",
    body: "Mở dashboard mẫu có sẵn để xem một báo cáo hoàn chỉnh trông thế nào, rồi sửa theo dữ liệu của bạn.",
  },
  {
    title: "Dữ liệu vẫn ở Google Sheets",
    body: "Bạn tiếp tục nhập liệu ở bảng tính quen thuộc. Không phải học công cụ mới, không phải chuyển dữ liệu đi đâu.",
  },
];

const AUDIENCE = [
  "Chủ shop bán hàng online",
  "Marketer, người chạy quảng cáo",
  "Kế toán, vận hành",
  "Giáo viên, trung tâm đào tạo",
  "Người làm nội dung, kênh YouTube",
  "Chủ doanh nghiệp nhỏ",
];

const STEPS = [
  {
    title: "Kết nối Google Sheets",
    body: "Đăng nhập bằng Google, chọn file và tab cần dùng. Cerno tự nhận diện cột số, ngày, chữ, kể cả số kiểu Việt Nam (1.234,5) và ngày dd/mm/yyyy.",
  },
  {
    title: "Thiết kế trên canvas tự do",
    body: "Thêm biểu đồ, KPI, bảng, văn bản, ảnh rồi đặt ở bất kỳ đâu. Chọn cột dữ liệu cho từng biểu đồ, không cần viết SQL hay công thức.",
  },
  {
    title: "Chia sẻ cho cả nhóm",
    body: "Gửi link xem, mời đồng nghiệp theo email (chỉ xem hoặc được sửa), hoặc nhúng thẳng dashboard vào website của công ty.",
  },
];

interface Group {
  color: string;
  icon: string;
  title: string;
  intro: string;
  points: string[];
  id?: string;
}

const GROUPS: Group[] = [
  {
    id: "du-lieu",
    color: "#22c3a6",
    icon: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
    title: "Dữ liệu từ Google Sheets, luôn mới",
    intro: "Bạn tiếp tục quản lý số liệu trong Google Sheets quen thuộc. Cerno chỉ đọc và vẽ lại thành dashboard.",
    points: [
      `<b>Tự cập nhật mỗi ${hours} giờ</b>, kèm nút "Cập nhật dữ liệu" khi cần số mới ngay.`,
      `Mỗi tab tới <b>${nf.format(MAX_ROWS)} dòng và ${MAX_COLUMNS} cột</b>; kết nối tối đa ${MAX_SOURCES_PER_WORKSPACE} nguồn.`,
      "<b>Trường tính toán</b>: tự viết công thức như SUM, AVG, IF để tạo cột mới mà không sửa file gốc.",
      "<b>Dự báo</b>: kéo dài biểu đồ đường hoặc vùng sang các kỳ tới, kèm dải tin cậy và sai số khi thử dự báo lại quá khứ.",
      "Chỉ truy cập các file bạn chọn (quyền drive.file, chỉ đọc), không thấy phần còn lại của Google Drive.",
      "Xem trước dữ liệu ngay trong trang quản lý, xóa nguồn bất cứ lúc nào.",
    ],
  },
  {
    id: "canvas",
    color: BRAND.violet,
    icon: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
    title: "Canvas tự do, không bị nhốt trong lưới",
    intro: "Đặt từng thành phần đúng chỗ bạn muốn, như thiết kế trên một tấm giấy trắng.",
    points: [
      "<b>Kéo, đổi kích thước, xoay</b> tới từng pixel, có đường gióng tự căn thẳng hàng với các thành phần khác.",
      "Chọn nhiều thành phần cùng lúc, nhân đôi, khóa vị trí, ẩn/hiện lớp, đổi thứ tự lớp.",
      "<b>Hoàn tác và làm lại</b> tới 100 bước, zoom và kéo canvas mượt, nhiều phím tắt.",
      `<b>Nhiều trang trong một dashboard</b> (tối đa ${MAX_PAGES}), thanh trang bên trái tùy chỉnh màu sắc, chuyển trang có hiệu ứng khi trình chiếu toàn màn hình.`,
      "Tự lưu liên tục lên tài khoản, mở lại ở máy nào cũng thấy.",
    ],
  },
  {
    id: "tuong-tac",
    color: "#a06cf5",
    icon: "M4 6h16M7 12h10M10 18h4",
    title: "Bộ lọc và lọc chéo cho người xem",
    intro: "Người xem tự khám phá số liệu mà không cần sửa dashboard.",
    points: [
      "<b>Bộ lọc dashboard</b>: danh sách chọn, chọn nhiều, thanh trượt và khoảng ngày (có lối tắt 7, 30, 90 ngày gần nhất).",
      "<b>Lọc chéo</b>: bấm vào một cột, lát hay điểm trên biểu đồ, mọi biểu đồ, KPI và bảng khác lọc theo ngay.",
      "Chọn bộ lọc áp cho toàn bộ dashboard hoặc chỉ một vài thành phần.",
      "Bảng cuộn được và sắp xếp được theo từng cột bằng một cú bấm.",
    ],
  },
  {
    id: "ai",
    color: "#f5a524",
    icon: "M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z",
    title: "Trợ lý AI dựng và sửa dashboard giúp bạn",
    intro: "Mô tả bằng tiếng Việt điều bạn muốn, trợ lý sẽ thao tác trực tiếp trên dashboard.",
    points: [
      'Ví dụ: "Thêm biểu đồ doanh thu theo tháng", "Đổi biểu đồ này thành cột ngang", "Thêm bộ lọc theo khu vực".',
      "<b>Mọi thao tác đều hoàn tác được</b>, có nút hoàn tác cả lượt và công tắc tắt quyền sửa.",
      "Trợ lý không động vào thành phần bạn đã khóa.",
      "Chỉ gửi bản tóm tắt đã gộp số liệu và vài dòng mẫu, không gửi toàn bộ dữ liệu của bạn.",
    ],
  },
  {
    id: "chia-se",
    color: "#f0568a",
    icon: "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
    title: "Chia sẻ theo cách bạn muốn",
    intro: "Từ gửi nhanh một link tới đưa dashboard vào chính website của công ty.",
    points: [
      "<b>Link xem công khai</b>: ai có link cũng xem và lọc được, không cần tài khoản. Tắt hoặc đổi link bất kỳ lúc nào.",
      "<b>Mời theo email Google</b> với hai mức quyền: chỉ xem hoặc được sửa (không thấy dashboard khác của bạn).",
      "<b>Nhúng vào website</b> bằng một đoạn iframe, chỉ các tên miền bạn khai báo mới nhúng được.",
      "Có hướng dẫn dán mã ngay trong ứng dụng cho website HTML, WordPress, Wix và Google Sites.",
    ],
  },
  {
    id: "mobile",
    color: "#34b6e6",
    icon: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM12 18h.01",
    title: "Tự sinh bố cục điện thoại, đọc gọn và rõ",
    intro: "Không phải thiết kế hai lần: bố cục điện thoại được dựng tự động từ thiết kế trên máy tính.",
    points: [
      "Xem trước ngay trong editor, ở cả hai hướng <b>dọc và ngang</b>.",
      "Các thành phần xếp một cột, chữ và con số tự co giãn để luôn vừa màn hình.",
      "Ẩn bớt thành phần nào đó trên điện thoại bằng một công tắc.",
    ],
  },
];

const CHARTS: Array<{ name: string; desc: string; path: string }> = [
  { name: "Cột", desc: "So sánh giá trị giữa các nhóm.", path: "M5 20V10M12 20V4M19 20v-7" },
  { name: "Cột ngang", desc: "Hợp với nhãn dài, xếp hạng.", path: "M4 5h10M4 12h16M4 19h7" },
  { name: "Cột chồng", desc: "Thấy cả tổng lẫn thành phần.", path: "M5 20v-6M5 14v-4M12 20v-9M12 11V5M19 20v-4M19 16v-3" },
  { name: "Đường", desc: "Xu hướng theo thời gian.", path: "M3 17l6-6 4 4 8-9" },
  { name: "Vùng", desc: "Xu hướng kèm độ lớn tích lũy.", path: "M3 17l6-6 4 4 8-9v11H3z" },
  { name: "Tròn", desc: "Tỉ trọng của từng phần.", path: "M12 3v9h9A9 9 0 1 1 12 3z" },
  { name: "Phễu", desc: "Tỉ lệ chuyển đổi qua các bước.", path: "M3 5h18l-6 7v7l-4-2v-5z" },
  { name: "Treemap", desc: "Diện tích ô theo giá trị, có hai tầng.", path: "M3 4h18v16H3zM12 4v16M12 11h9" },
  {
    name: "Phân tán",
    desc: "Mối quan hệ giữa hai số đo, cỡ chấm là số đo thứ ba.",
    path: "M6 17a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M11 9a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M16 14a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M16 5a1 1 0 1 0 2 0 1 1 0 1 0-2 0",
  },
  { name: "Radar", desc: "So sánh nhiều tiêu chí cùng lúc.", path: "M12 3l8.5 6.2-3.2 10H6.7l-3.2-10zM12 9l4 3-1.5 4h-5L8 12z" },
  { name: "Đồng hồ", desc: "Một chỉ số so với mốc tối đa.", path: "M4 17a8 8 0 1 1 16 0M12 17l4-5" },
  {
    name: "Bản đồ nhiệt",
    desc: "Ô càng đậm, giá trị càng lớn.",
    path: "M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z",
  },
];

const EXTRA_WIDGETS = "Ngoài biểu đồ còn có thẻ KPI, bảng dữ liệu, ô văn bản và ảnh (tải ảnh từ máy). Mọi thành phần chỉnh được chữ, màu, viền, bo góc, căn lề.";

const TRUST = [
  { title: "Chỉ đọc dữ liệu của bạn", body: "Cerno không sửa hay xóa gì trong Google Sheets. Quyền truy cập giới hạn ở những file bạn chọn." },
  { title: "Mã truy cập được mã hóa", body: "Mã làm mới của Google được mã hóa AES-256 trước khi lưu và chỉ máy chủ mới đọc được." },
  { title: "Dữ liệu tách theo tài khoản", body: "Mỗi tài khoản chỉ thấy dữ liệu của mình nhờ cơ chế bảo mật ở tầng cơ sở dữ liệu." },
  { title: "Tự xóa mọi thứ", body: "Xóa nguồn dữ liệu hoặc xóa cả tài khoản ngay trong ứng dụng, kèm ảnh đã tải lên và quyền Google." },
  { title: "Không dùng dữ liệu để huấn luyện AI", body: "Trợ lý AI chỉ nhận bản tóm tắt cần thiết cho yêu cầu hiện tại." },
  { title: "Trang xem và nhúng có kiểm soát", body: "Tắt link hoặc tạo link mới là link cũ ngừng ngay. Nhúng chỉ chạy trên tên miền bạn cho phép." },
];

const SOON = [
  { title: "Ứng dụng iOS và Android", body: "Xem dashboard, đổi bộ lọc, bình luận ngay trên điện thoại." },
  { title: "Thông báo khi vượt ngưỡng", body: "Đặt ngưỡng cho chỉ số và nhận thông báo đẩy khi dữ liệu vượt qua." },
  { title: "Bình luận trên dashboard", body: "Trao đổi với đồng nghiệp ngay trên số liệu." },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: `${site.name} là gì và dùng để làm gì?`,
    a: `${site.name} là ứng dụng web giúp bạn tự thiết kế dashboard từ dữ liệu trong Google Sheets. Bạn chọn file, đặt biểu đồ, KPI, bảng lên canvas tự do rồi chia sẻ link hoặc nhúng vào website. Phù hợp để làm báo cáo bán hàng, marketing, vận hành, theo dõi kênh YouTube hay bất cứ bảng số liệu nào bạn đang quản lý trên Google Sheets.`,
  },
  {
    q: `${site.name} có miễn phí không?`,
    a: `Hiện ${site.name} miễn phí trong giai đoạn thử nghiệm, chưa thu phí. Có hạn mức: tối đa ${MAX_DASHBOARDS_PER_WORKSPACE} dashboard, ${MAX_SOURCES_PER_WORKSPACE} nguồn dữ liệu mỗi tài khoản, và dữ liệu tự cập nhật mỗi ${hours} giờ.`,
  },
  {
    q: "Tôi có cần biết lập trình hoặc SQL không?",
    a: "Không. Bạn chọn cột dữ liệu và phép tính (tổng, trung bình, đếm, lớn nhất, nhỏ nhất, đếm giá trị khác nhau) bằng ô chọn. Muốn tạo cột mới có thể dùng trường tính toán với công thức quen thuộc như trong bảng tính, hoặc nhờ trợ lý AI làm giúp.",
  },
  {
    q: "Cerno có thay đổi hay xóa dữ liệu trong Google Sheets của tôi không?",
    a: "Không. Cerno chỉ đọc. Ứng dụng chỉ xin quyền truy cập các file bạn chọn (quyền drive.file), không xem được phần còn lại của Google Drive. Bạn có thể thu hồi quyền bất cứ lúc nào trong tài khoản Google.",
  },
  {
    q: "Dữ liệu cập nhật bao lâu một lần?",
    a: `Tự động mỗi ${hours} giờ, và bạn có thể bấm nút "Cập nhật dữ liệu" để lấy số mới nhất ngay. Google Sheets không có cơ chế báo thay đổi đủ tin cậy nên hệ thống kiểm tra định kỳ và chỉ cập nhật khi nội dung sheet thật sự đổi.`,
  },
  {
    q: "Người không có tài khoản có xem được dashboard không?",
    a: "Có, nếu bạn bật link xem công khai hoặc nhúng dashboard vào website. Bạn cũng có thể chỉ mời đích danh một số email Google với quyền chỉ xem hoặc được sửa. Link có thể tắt hoặc đổi bất cứ lúc nào.",
  },
  {
    q: "Có thể nhúng dashboard vào website của công ty không?",
    a: "Được. Bật tính năng nhúng, khai báo tên miền được phép (ví dụ congty.com), rồi dán đoạn mã iframe vào trang web. Website phải chạy bằng https. Website khác không khai báo sẽ không nhúng được.",
  },
  {
    q: "Dashboard xem được trên điện thoại không?",
    a: `${site.name} tự sinh bố cục gọn cho điện thoại và cho xem trước ngay trong trình chỉnh sửa, ở cả hai hướng dọc và ngang. Ứng dụng iOS và Android riêng (xem, lọc, bình luận, thông báo) đang được phát triển, chưa phát hành.`,
  },
  {
    q: "Dữ liệu của tôi có an toàn và có bị dùng để huấn luyện AI không?",
    a: "Dữ liệu của mỗi tài khoản được tách riêng ở tầng cơ sở dữ liệu, mã truy cập Google được mã hóa trước khi lưu. Trợ lý AI chỉ nhận bản tóm tắt đã gộp cùng vài dòng mẫu cho yêu cầu hiện tại, và dữ liệu không được dùng để huấn luyện mô hình AI. Chi tiết xem trong Chính sách quyền riêng tư.",
  },
  {
    q: "Tôi có xóa được tài khoản và dữ liệu không?",
    a: "Được, ngay trong ứng dụng. Xóa nguồn dữ liệu sẽ xóa bản sao dữ liệu đã lưu. Xóa tài khoản sẽ xóa toàn bộ dashboard, nguồn, ảnh đã tải lên và thu hồi quyền Google. File Google Sheets gốc của bạn không bị ảnh hưởng.",
  },
  {
    q: "Ngoài Google Sheets còn kết nối được nguồn nào khác không?",
    a: "Hiện chỉ hỗ trợ Google Sheets. Excel, CSV và cơ sở dữ liệu chưa có.",
  },
];

const FEATURE_LIST = [
  "Kết nối Google Sheets và tự cập nhật dữ liệu",
  "Canvas kéo-thả tự do, xoay, đường gióng, hoàn tác",
  "13 loại biểu đồ: cột, cột ngang, cột chồng, đường, vùng, tròn, phễu, treemap, phân tán, radar, đồng hồ, bản đồ nhiệt, bảng",
  "Thẻ KPI, văn bản, ảnh",
  "Nhiều trang trong một dashboard",
  "Bộ lọc, lọc chéo, khoảng ngày",
  "Trường tính toán bằng công thức",
  "Dự báo xu hướng kèm dải tin cậy",
  "Trợ lý AI dựng và sửa dashboard",
  "Chia sẻ bằng link, mời theo email, nhúng iframe",
  "Bố cục điện thoại tự sinh",
];

export default function HomePage() {
  const base = siteUrl();
  const graph = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: site.name,
      url: base,
      description: site.description,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: "vi",
      offers: { "@type": "Offer", price: "0", priceCurrency: "VND" },
      featureList: FEATURE_LIST,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: site.name,
      url: base,
      inLanguage: "vi",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];

  return (
    <>
      <CircuitBackground />
      <RevealController />
      {graph.map((g, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(g) }} />
      ))}

      <header className="hero">
        <nav className="nav" aria-label="Điều hướng chính">
          <Link href="/" className="logo" aria-label={site.name}>
            <Brand size={28} tone="strong" />
          </Link>
          <div className="navLinks">
            <a href="#tinh-nang">Tính năng</a>
            <a href="#bieu-do">Biểu đồ</a>
            <a href="#bao-mat">Bảo mật</a>
            <a href="#hoi-dap">Hỏi đáp</a>
            <LangSwitch />
            <Link href="/login" className="btn btnGhost btnSm">Đăng nhập</Link>
            <Link href="/dashboards" className="btn btnPrimary btnSm">Dùng thử miễn phí</Link>
          </div>
        </nav>

        <div className="heroInner">
          <span className="badge"><i /> Miễn phí trong giai đoạn thử nghiệm</span>
          <h1 className="heroTitle">
            Tạo <span className="gradientText">dashboard từ Google Sheets</span>, đặt biểu đồ tự do như bạn muốn
          </h1>
          <p className="heroSub">{site.description}</p>
          <p className="heroPromise">Không cần biết lập trình. Không cần là dân data.</p>
          <div className="heroCta">
            <Link href="/dashboards" className="btn btnPrimary">Bắt đầu miễn phí</Link>
            <a href="#cach-hoat-dong" className="btn btnGhost">Xem cách hoạt động</a>
          </div>
        </div>

        <div className="scene">
          <HeroScene />
        </div>
      </header>

      <main>
        <div className={s.stats} role="list" aria-label="Điểm nổi bật">
          <div className={s.stat} role="listitem"><CountUp to={13} /><span>loại biểu đồ</span></div>
          <div className={s.stat} role="listitem"><CountUp to={hours} suffix=" giờ" /><span>tự cập nhật dữ liệu</span></div>
          <div className={s.stat} role="listitem"><CountUp to={0} suffix=" đồng" /><span>giai đoạn thử nghiệm</span></div>
          <div className={s.stat} role="listitem"><CountUp to={3} suffix=" cách" /><span>chia sẻ: link, mời, nhúng</span></div>
        </div>

        <section className={s.wrap} id="vi-du" aria-labelledby="h-demo">
          <span className={s.eyebrow}>Dashboard thật</span>
          <h2 data-rv className={s.h2} id="h-demo">Một báo cáo hoàn chỉnh, dựng từ Google Sheets bằng {site.name}</h2>
          <p data-rv className={s.lead}>
            Đây là dashboard phân tích kênh YouTube, thiết kế bằng chính {site.name} và lấy số liệu từ một file Google Sheets.
            Bạn đang xem bản chạy thật: bấm vào một cột hay một lát để lọc các biểu đồ còn lại, chuyển giữa hai trang ở
            thanh bên trái.
          </p>
          <div className={s.shotFloat}>
          <figure data-rv className={s.shot}>
            <div className={s.shotBar} aria-hidden>
              <i /><i /><i />
              <span>Dùng thử ngay: bấm vào biểu đồ, đổi trang ở thanh bên trái</span>
            </div>
            <DemoSlot />
            <figcaption>Ví dụ thực tế: dashboard phân tích kênh YouTube &quot;Tiếng Anh Không Khó&quot;, thiết kế hoàn toàn trong {site.name}. Bản dùng thử, số liệu chỉ để minh hoạ.</figcaption>
          </figure>
          </div>
        </section>

        <section className={s.wrap} id="danh-cho-ai" aria-labelledby="h-everyone">
          <span className={s.eyebrow}>Dành cho mọi người</span>
          <h2 data-rv className={s.h2} id="h-everyone">Không cần biết lập trình. Không cần là dân data.</h2>
          <p data-rv className={s.lead}>
            Nếu bạn dùng được Google Sheets thì bạn làm được dashboard. {site.name} lo phần tính toán và vẽ biểu đồ,
            bạn chỉ cần quyết định muốn xem điều gì.
          </p>
          <div className={s.cards} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
            {FOR_EVERYONE.map((t, i) => (
              <article data-rv style={{ ["--i" as string]: i }} className={s.mini} key={t.title}>
                <h3>{t.title}</h3>
                <p>{t.body}</p>
              </article>
            ))}
          </div>
          <p className={s.audienceLabel}>Phù hợp với</p>
          <div className={s.marquee}>
            <div className={s.track}>
              <ul>
                {AUDIENCE.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              <ul className={s.dup} aria-hidden>
                {AUDIENCE.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={s.wrap} id="cach-hoat-dong" aria-labelledby="h-steps">
          <span className={s.eyebrow}>Cách hoạt động</span>
          <h2 data-rv className={s.h2} id="h-steps">Từ bảng tính tới dashboard trong ba bước</h2>
          <p data-rv className={s.lead}>Không cài đặt, không viết truy vấn. Mở trình duyệt, đăng nhập Google và bắt đầu.</p>
          <div data-rv><FlowDiagram /></div>
          <ol className={s.steps}>
            {STEPS.map((st, i) => (
              <li data-rv style={{ ["--i" as string]: i }} className={s.step} key={st.title}>
                <h3>{st.title}</h3>
                <p>{st.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={`${s.alt}`} id="tinh-nang" aria-labelledby="h-features">
          <div className={s.wrap}>
            <span className={s.eyebrow}>Tính năng</span>
            <h2 data-rv className={s.h2} id="h-features">Mọi thứ để biến số liệu thành câu chuyện</h2>
            <p data-rv className={s.lead}>Công cụ thiết kế dashboard cho cá nhân và doanh nghiệp nhỏ, dùng ngay trên trình duyệt.</p>
            <div className={s.groups}>
              {GROUPS.map((g) => (
                <article data-rv className={s.group} key={g.title} id={g.id} style={{ ["--k" as string]: g.color }}>
                  <div className={s.groupText}>
                    <div className={s.groupIcon} aria-hidden>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round"><path d={g.icon} /></svg>
                    </div>
                    <h3>{g.title}</h3>
                    <p>{g.intro}</p>
                  </div>
                  <ul className={s.ticks}>
                    {g.points.map((p) => (
                      <li key={p} dangerouslySetInnerHTML={{ __html: p }} />
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={s.wrap} id="bieu-do" aria-labelledby="h-charts">
          <span className={s.eyebrow}>Thư viện biểu đồ</span>
          <h2 data-rv className={s.h2} id="h-charts">13 loại biểu đồ cho mọi kiểu số liệu</h2>
          <p data-rv className={s.lead}>Đổi loại biểu đồ bất cứ lúc nào, dữ liệu và định dạng tự điều chỉnh theo.</p>
          <div className={s.charts}>
            {CHARTS.map((c, i) => (
              <article data-rv style={{ ["--i" as string]: i % 4 }} className={s.chartTile} key={c.name}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={c.path} pathLength={1} /></svg>
                <h3>{c.name}</h3>
                <p>{c.desc}</p>
              </article>
            ))}
            <article data-rv style={{ ["--i" as string]: 1 }} className={s.chartTile}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 5h18v14H3zM3 10h18M9 5v14" pathLength={1} /></svg>
              <h3>Bảng dữ liệu</h3>
              <p>Cuộn, sắp xếp theo cột, nhóm và tính tổng.</p>
            </article>
          </div>
          <p className={s.note}>{EXTRA_WIDGETS}</p>
        </section>

        <section className={s.alt} id="bao-mat" aria-labelledby="h-trust">
          <div className={s.wrap}>
            <span className={s.eyebrow}>Bảo mật và quyền riêng tư</span>
            <h2 data-rv className={s.h2} id="h-trust">Dữ liệu của bạn vẫn là của bạn</h2>
            <p data-rv className={s.lead}>
              Đọc kỹ <Link href="/privacy" style={{ textDecoration: "underline" }}>Chính sách quyền riêng tư</Link> để biết chính xác
              chúng tôi lưu gì và trong bao lâu.
            </p>
            <div className={s.cards}>
              {TRUST.map((t, i) => (
                <article data-rv style={{ ["--i" as string]: i % 3 }} className={s.mini} key={t.title}>
                  <h3>{t.title}</h3>
                  <p>{t.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={s.wrap} id="bang-gia" aria-labelledby="h-price">
          <span className={s.eyebrow}>Chi phí</span>
          <h2 data-rv className={s.h2} id="h-price">Miễn phí trong giai đoạn thử nghiệm</h2>
          <p data-rv className={s.lead}>Chưa thu phí, không cần thẻ tín dụng. Các hạn mức dưới đây giúp hệ thống chạy ổn định cho mọi người.</p>
          <div data-rv className={s.price}>
            <b>0 đồng</b>
            <span style={{ color: "var(--muted)" }}>cho mỗi tài khoản</span>
            <ul className={s.ticks}>
              <li>Tối đa <b>{MAX_DASHBOARDS_PER_WORKSPACE} dashboard</b>, mỗi dashboard tới {MAX_PAGES} trang</li>
              <li>Tối đa <b>{MAX_SOURCES_PER_WORKSPACE} nguồn</b> Google Sheets</li>
              <li>Tự cập nhật dữ liệu mỗi {hours} giờ, cập nhật tay khi cần</li>
              <li>Đầy đủ 13 loại biểu đồ, bộ lọc, trợ lý AI, chia sẻ và nhúng</li>
            </ul>
            <Link href="/dashboards" className="btn btnPrimary">Tạo dashboard miễn phí</Link>
          </div>
        </section>

        <section className={s.alt} aria-labelledby="h-soon">
          <div className={s.wrap}>
            <span className={s.eyebrow}>Đang phát triển</span>
            <h2 data-rv className={s.h2} id="h-soon">Sắp có trong các bản tới</h2>
            <p data-rv className={s.lead}>Những tính năng dưới đây chưa phát hành. Chúng tôi sẽ cập nhật khi sẵn sàng.</p>
            <div className={s.cards}>
              {SOON.map((t, i) => (
                <article data-rv style={{ ["--i" as string]: i }} className={s.mini} key={t.title}>
                  <h3>{t.title}<span className={s.soon}>Sắp có</span></h3>
                  <p>{t.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={s.wrap} id="hoi-dap" aria-labelledby="h-faq">
          <span className={s.eyebrow}>Hỏi đáp</span>
          <h2 data-rv className={s.h2} id="h-faq">Câu hỏi thường gặp</h2>
          <div data-rv className={s.faq}>
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section data-rv className="ctaBand" aria-labelledby="h-cta">
          <h2 className="sectionTitle" id="h-cta">Dựng dashboard đầu tiên trong vài phút</h2>
          <p className="sectionSub">Không cần thẻ tín dụng. Kết nối Google Sheets và bắt đầu.</p>
          <div className="heroCta">
            <Link href="/dashboards" className="btn btnPrimary">Tạo dashboard miễn phí</Link>
            <Link href="/login" className="btn btnGhost">Đăng nhập</Link>
          </div>
        </section>
      </main>

      <footer className={s.foot}>
        <div className={s.footGrid}>
          <div>
            <Link href="/" className="logo" aria-label={site.name}>
              <Brand size={26} tone="strong" />
            </Link>
            <p className={s.footAbout}>{site.tagline}. Dùng Google Sheets làm nguồn dữ liệu.</p>
          </div>
          <nav aria-label="Sản phẩm">
            <h3>Sản phẩm</h3>
            <ul>
              <li><a href="#cach-hoat-dong">Cách hoạt động</a></li>
              <li><a href="#tinh-nang">Tính năng</a></li>
              <li><a href="#bieu-do">Biểu đồ</a></li>
              <li><a href="#hoi-dap">Hỏi đáp</a></li>
            </ul>
          </nav>
          <nav aria-label="Pháp lý và liên hệ">
            <h3>Pháp lý</h3>
            <ul>
              <li><Link href="/privacy">Chính sách quyền riêng tư</Link></li>
              <li><Link href="/terms">Điều khoản sử dụng</Link></li>
              <li><a href={`mailto:${site.legal.contactEmail}`}>Liên hệ</a></li>
            </ul>
          </nav>
        </div>
        <p className={s.copy}>© {new Date().getFullYear()} {site.name}. {site.legal.operator}.</p>
        <div className={s.footLang}><LangSwitch /></div>
      </footer>
    </>
  );
}
