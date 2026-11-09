import type { Metadata } from "next";
import Link from "next/link";
import { Callout, LegalShell, Section } from "@/components/legal/Legal";
import t from "@/components/legal/legal.module.css";
import { AUTO_SYNC_MINUTES } from "@/lib/google/constants";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `Chính sách quyền riêng tư | ${site.name}`,
  description: `Cách ${site.name} thu thập, sử dụng và bảo vệ dữ liệu của bạn, gồm cả dữ liệu lấy từ Google Sheets.`,
};

const POLICY_URL = "https://developers.google.com/terms/api-services-user-data-policy";
const hours = AUTO_SYNC_MINUTES / 60;

export default function PrivacyPage() {
  const name = site.name;
  const mail = site.legal.contactEmail;

  return (
    <LegalShell title="Chính sách quyền riêng tư">
      <Section id="gioi-thieu" title="1. Giới thiệu">
        <p>
          {name} là ứng dụng giúp bạn thiết kế dashboard từ dữ liệu của chính bạn (hiện là Google Sheets), xem trên web và
          điện thoại. Dịch vụ do <strong>{site.legal.operator}</strong> vận hành (“chúng tôi”). Chính sách này giải thích chúng
          tôi thu thập dữ liệu gì, dùng để làm gì, chia sẻ với ai và bạn có những quyền nào. Dùng {name} nghĩa là bạn đã
          đọc chính sách này và <Link href="/terms">Điều khoản sử dụng</Link>.
        </p>
      </Section>

      <Section id="du-lieu-thu-thap" title="2. Dữ liệu chúng tôi thu thập">
        <h3>2.1. Thông tin tài khoản</h3>
        <p>
          Khi bạn đăng nhập bằng Google, chúng tôi nhận <strong>tên, địa chỉ email, ảnh đại diện và mã định danh tài khoản
          Google</strong> của bạn. Chúng tôi không nhận mật khẩu Google của bạn.
        </p>

        <h3>2.2. Dữ liệu từ Google Sheets (dữ liệu người dùng Google)</h3>
        <p>
          {name} chỉ xin quyền Google ở mức <code>drive.file</code>: truy cập <strong>duy nhất những file bạn chủ động chọn</strong>{" "}
          bằng hộp thoại Google Picker. Chúng tôi không xem được các file khác trong Google Drive của bạn, không truy cập
          Gmail, Lịch hay danh bạ.
        </p>
        <p>Với file bạn đã chọn, chúng tôi <strong>chỉ đọc</strong> (không tạo, sửa, xóa hay chia sẻ file):</p>
        <ul>
          <li>tên file và danh sách các tab;</li>
          <li>nội dung các ô của tab bạn chọn làm nguồn dữ liệu.</li>
        </ul>
        <p>
          Chúng tôi lưu một <strong>bản sao</strong> (giá trị các ô, tên cột và kiểu cột đã nhận diện) trong cơ sở dữ liệu của {name},
          để vẽ biểu đồ nhanh mà không gọi Google mỗi lần bạn xem. Bản sao được tự động làm mới mỗi {hours} giờ và khi bạn bấm
          “Cập nhật dữ liệu”.
        </p>
        <p>
          Để làm mới tự động khi bạn không trực tuyến, chúng tôi lưu <strong>mã làm mới (refresh token)</strong> của Google.
          Mã này được <strong>mã hóa</strong> (AES-256-GCM) trước khi lưu và chỉ máy chủ của chúng tôi đọc được.
        </p>

        <h3>2.3. Nội dung bạn tạo</h3>
        <ul>
          <li>Các dashboard của bạn (vị trí, loại biểu đồ, cột dữ liệu được dùng, bộ lọc, màu sắc, tên trang...).</li>
          <li>
            Ảnh bạn tải lên (vd logo). Ảnh được lưu ở kho ảnh <strong>công khai theo đường dẫn</strong>: ai có đúng đường dẫn
            đều xem được ảnh đó. Vì vậy đừng tải lên ảnh nhạy cảm.
          </li>
        </ul>

        <h3>2.4. Dữ liệu kỹ thuật</h3>
        <ul>
          <li>Cookie phiên đăng nhập (xem mục 9).</li>
          <li>
            Địa chỉ IP được dùng tạm thời trong bộ nhớ máy chủ để giới hạn tần suất gọi trợ lý AI (chống lạm dụng), không lưu
            lâu dài vào cơ sở dữ liệu. Nhà cung cấp hosting có thể ghi nhật ký truy cập theo cấu hình của họ.
          </li>
          <li>Thông báo lỗi kỹ thuật khi một thao tác thất bại (không chứa nội dung dữ liệu của bạn).</li>
        </ul>

        <h3>2.5. Dữ liệu chúng tôi không thu thập</h3>
        <p>
          Hiện {name} miễn phí nên chúng tôi <strong>không thu thông tin thanh toán</strong>, không dùng cookie quảng cáo và
          chưa dùng công cụ phân tích hành vi. Nếu sau này thay đổi, chúng tôi sẽ cập nhật chính sách này trước khi áp dụng.
        </p>
      </Section>

      <Section id="muc-dich" title="3. Chúng tôi dùng dữ liệu để làm gì">
        <ul>
          <li>Đăng nhập, nhận diện bạn và giữ dashboard của bạn riêng tư.</li>
          <li>Đọc dữ liệu từ các file Google Sheets bạn đã chọn và vẽ thành biểu đồ, bảng, KPI.</li>
          <li>Chạy các tính năng bạn bật: tự cập nhật dữ liệu, trợ lý AI, chia sẻ và thông báo (khi có).</li>
          <li>Bảo vệ dịch vụ: chống lạm dụng, điều tra lỗi bảo mật, tuân thủ pháp luật.</li>
          <li>Trả lời khi bạn liên hệ hỗ trợ.</li>
        </ul>
        <p>
          Chúng tôi <strong>không bán</strong> dữ liệu của bạn, không dùng để quảng cáo, và <strong>không dùng dữ liệu của bạn
          (kể cả dữ liệu từ Google) để huấn luyện mô hình AI</strong>.
        </p>
      </Section>

      <Section id="google-limited-use" title="4. Dữ liệu từ Google và yêu cầu “Limited Use”">
        <Callout>
          <p>
            {name}’s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
            <a href={POLICY_URL} target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the
            Limited Use requirements.
          </p>
          <p>
            Việc {name} sử dụng và chuyển giao thông tin nhận được từ các API của Google sang bất kỳ ứng dụng nào khác sẽ tuân
            thủ Chính sách dữ liệu người dùng của Google API Services, bao gồm cả các yêu cầu về Sử dụng hạn chế (Limited Use).
          </p>
        </Callout>
        <p>Cụ thể:</p>
        <ul>
          <li>Chúng tôi chỉ dùng dữ liệu Google để cung cấp và cải thiện các tính năng bạn thấy trên màn hình (dashboard từ Sheets của bạn).</li>
          <li>Chúng tôi không chuyển dữ liệu Google cho bên khác, trừ khi cần để cung cấp tính năng bạn yêu cầu (mục 5, 6), để tuân thủ pháp luật, hoặc khi bạn đồng ý.</li>
          <li>Con người của chúng tôi không đọc dữ liệu Google của bạn, trừ khi bạn cho phép (vd để hỗ trợ), vì mục đích bảo mật, hoặc theo yêu cầu pháp luật.</li>
          <li>Chúng tôi không dùng dữ liệu Google để quảng cáo và không dùng để phát triển hay huấn luyện mô hình AI/học máy tổng quát.</li>
        </ul>
      </Section>

      <Section id="tro-ly-ai" title="5. Trợ lý AI">
        <p>
          Khi bạn nhắn tin cho trợ lý AI, ứng dụng gửi tới nhà cung cấp AI (mục 6) <strong>một bản tóm tắt dashboard</strong> để
          trả lời đúng ngữ cảnh, gồm: câu hỏi của bạn; cấu trúc dashboard (tên biểu đồ, tên cột); số liệu đã được gộp (tổng,
          trung bình, nhỏ nhất, lớn nhất, kết quả của từng biểu đồ); bộ lọc đang bật; và <strong>tối đa 3 dòng dữ liệu mẫu</strong>{" "}
          của mỗi nguồn (giá trị thật của các ô trong những dòng đó). Chúng tôi <strong>không</strong> gửi toàn bộ bảng dữ liệu.
        </p>
        <p>
          Nếu bạn không muốn gửi những thông tin này, đừng dùng khung chat AI: không nhắn thì không có gì được gửi đi. Chúng
          tôi không lưu nội dung hội thoại với AI trên máy chủ của mình (lịch sử chỉ nằm trong trình duyệt của bạn cho tới khi bạn
          đóng hoặc xóa).
        </p>
      </Section>

      <Section id="chia-se" title="6. Chia sẻ dữ liệu và bên xử lý">
        <p>Chúng tôi dùng các nhà cung cấp sau để vận hành dịch vụ. Họ chỉ xử lý dữ liệu theo mục đích dưới đây:</p>
        <div className={t.tableWrap}>
          <table className={t.table}>
            <thead>
              <tr><th>Bên</th><th>Vai trò</th><th>Dữ liệu liên quan</th></tr>
            </thead>
            <tbody>
              <tr><td>Google</td><td>Đăng nhập (OAuth), hộp chọn file (Picker), đọc Google Sheets (Sheets API)</td><td>Thông tin tài khoản; file và nội dung ô bạn chọn</td></tr>
              <tr><td>Supabase</td><td>Xác thực, cơ sở dữ liệu, kho lưu trữ ảnh</td><td>Tài khoản, dashboard, bản sao dữ liệu Sheets, token mã hóa, ảnh</td></tr>
              <tr><td>Groq</td><td>Trợ lý AI (khi bạn dùng)</td><td>Bản tóm tắt dashboard ở mục 5. Groq xử lý theo thỏa thuận dịch vụ và chính sách riêng của họ: <a href="https://groq.com/privacy-policy" target="_blank" rel="noreferrer">groq.com/privacy-policy</a></td></tr>
              <tr><td>Nhà cung cấp hosting</td><td>Chạy ứng dụng web</td><td>Dữ liệu đi qua máy chủ khi bạn dùng dịch vụ; nhật ký truy cập</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          Ngoài các bên trên, chúng tôi không chia sẻ dữ liệu của bạn cho ai, trừ khi pháp luật yêu cầu hoặc bạn tự bật tính năng
          chia sẻ (ví dụ mời người khác cùng xem dashboard, khi tính năng này có).
        </p>
      </Section>

      <Section id="luu-giu" title="7. Thời gian lưu giữ và xóa dữ liệu">
        <ul>
          <li>Dashboard: lưu cho tới khi bạn xóa. Xóa dashboard trong ứng dụng là xóa khỏi cơ sở dữ liệu của chúng tôi.</li>
          <li>Bản sao dữ liệu Google Sheets: lưu cho tới khi bạn xóa nguồn dữ liệu (nút “Xóa nguồn” ở trang quản lý) hoặc xóa tài khoản.</li>
          <li>Mã làm mới Google: lưu cho tới khi bạn xóa tài khoản hoặc thu hồi quyền ở Google (khi đó chúng tôi không đọc thêm được dữ liệu mới).</li>
          <li>Ảnh bạn tải lên: lưu cho tới khi bạn xóa tài khoản hoặc yêu cầu xóa.</li>
          <li>
            <strong>Tự xóa tài khoản:</strong> vào trang “Tài khoản” trong ứng dụng, gõ lại email để xác nhận. Chúng tôi xóa ngay khỏi hệ
            thống đang chạy: toàn bộ dashboard, nguồn dữ liệu và bản sao, ảnh đã tải lên, mã làm mới Google (đồng thời thu hồi quyền ở phía
            Google) và tài khoản đăng nhập. Thao tác không thể khôi phục. File Google Sheets gốc của bạn không bị ảnh hưởng.
          </li>
          <li>
            Nếu cần hỗ trợ xóa, gửi email tới <a href={`mailto:${mail}`}>{mail}</a>, chúng tôi xử lý trong vòng 30 ngày.
            Dữ liệu có thể còn tồn tại trong bản sao lưu của nhà cung cấp hạ tầng cho tới khi bị ghi đè theo chu kỳ của họ.
          </li>
        </ul>
      </Section>

      <Section id="bao-mat" title="8. Bảo mật">
        <ul>
          <li>Truyền tải qua HTTPS.</li>
          <li>Mỗi workspace được cô lập ở tầng cơ sở dữ liệu (Row Level Security): người dùng chỉ đọc và sửa được dữ liệu thuộc workspace của mình.</li>
          <li>Mã làm mới Google được mã hóa AES-256-GCM; khóa mã hóa và khóa dịch vụ chỉ nằm trên máy chủ, không bao giờ gửi xuống trình duyệt.</li>
          <li>Các lệnh do trợ lý AI đề xuất được kiểm tra trước khi áp dụng và có thể hoàn tác.</li>
        </ul>
        <p>Không hệ thống nào an toàn tuyệt đối. Nếu phát hiện sự cố bảo mật ảnh hưởng đến bạn, chúng tôi sẽ thông báo theo quy định pháp luật.</p>
      </Section>

      <Section id="cookie" title="9. Cookie và lưu trữ trên trình duyệt">
        <p>
          Chúng tôi chỉ dùng cookie <strong>cần thiết</strong>: cookie phiên đăng nhập của Supabase, để bạn không phải đăng nhập lại.
          Không có cookie quảng cáo hay theo dõi. Trình duyệt có thể còn lưu bản nháp dashboard cũ (localStorage) từ thời bản
          thử nghiệm; bạn có thể chuyển nó lên tài khoản hoặc xóa dữ liệu trang trong trình duyệt.
        </p>
      </Section>

      <Section id="quyen" title="10. Quyền của bạn">
        <ul>
          <li><strong>Truy cập, chỉnh sửa:</strong> xem và sửa dashboard của bạn ngay trong ứng dụng; xuất dashboard ra file JSON.</li>
          <li><strong>Xóa:</strong> tự xóa dashboard, nguồn dữ liệu và tài khoản ngay trong ứng dụng (mục 7); hoặc yêu cầu qua email.</li>
          <li>
            <strong>Thu hồi quyền Google:</strong> vào{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>,
            chọn {name} và bỏ quyền truy cập bất cứ lúc nào.
          </li>
          <li><strong>Rút lại sự đồng ý, phản đối hoặc hỏi về dữ liệu của bạn:</strong> liên hệ <a href={`mailto:${mail}`}>{mail}</a>.</li>
        </ul>
      </Section>

      <Section id="tre-em" title="11. Trẻ em">
        <p>{name} không dành cho người dưới 16 tuổi và chúng tôi không cố ý thu thập dữ liệu của họ. Nếu bạn cho rằng một trẻ em đã đăng ký, hãy liên hệ để chúng tôi xóa.</p>
      </Section>

      <Section id="quoc-te" title="12. Xử lý dữ liệu ngoài Việt Nam">
        <p>
          Các nhà cung cấp ở mục 6 có thể xử lý và lưu trữ dữ liệu trên máy chủ đặt ngoài Việt Nam. Bằng việc dùng dịch vụ, bạn
          hiểu và đồng ý với việc này, và chúng tôi chỉ chọn nhà cung cấp có cam kết bảo mật phù hợp.
        </p>
      </Section>

      <Section id="thay-doi" title="13. Thay đổi chính sách">
        <p>
          Khi có thay đổi quan trọng (ví dụ thu thêm loại dữ liệu mới hoặc dùng dữ liệu cho mục đích mới), chúng tôi sẽ cập nhật
          trang này và ngày “Cập nhật lần cuối”, đồng thời thông báo trong ứng dụng hoặc qua email trước khi áp dụng.
        </p>
      </Section>

      <Section id="lien-he" title="14. Liên hệ">
        <p>
          Mọi câu hỏi hoặc yêu cầu về quyền riêng tư: <a href={`mailto:${mail}`}>{mail}</a>. Đơn vị vận hành: {site.legal.operator}.
        </p>
      </Section>
    </LegalShell>
  );
}
