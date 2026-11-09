import type { Metadata } from "next";
import Link from "next/link";
import { MAX_PAGES } from "@dashboard/schema";
import { LegalShell, Section } from "@/components/legal/Legal";
import { AUTO_SYNC_MINUTES } from "@/lib/google/constants";
import { MAX_CELLS, MAX_COLUMNS, MAX_ROWS } from "@/lib/google/sheet-data";
import { MAX_DASHBOARDS_PER_WORKSPACE, MAX_ROWS_PER_WORKSPACE, MAX_SOURCES_PER_WORKSPACE } from "@/lib/limits";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `Điều khoản sử dụng | ${site.name}`,
  description: `Các điều khoản khi sử dụng ${site.name}.`,
};

const vn = (n: number) => n.toLocaleString("vi-VN");

export default function TermsPage() {
  const name = site.name;
  const mail = site.legal.contactEmail;

  return (
    <LegalShell title="Điều khoản sử dụng">
      <Section id="chap-nhan" title="1. Chấp nhận điều khoản">
        <p>
          Khi tạo tài khoản hoặc sử dụng {name} (“Dịch vụ”) do <strong>{site.legal.operator}</strong> vận hành (“chúng tôi”), bạn
          đồng ý với các điều khoản này và với <Link href="/privacy">Chính sách quyền riêng tư</Link>. Nếu không đồng ý, vui
          lòng không sử dụng Dịch vụ.
        </p>
      </Section>

      <Section id="dich-vu" title="2. Dịch vụ">
        <p>
          {name} cho phép bạn kết nối file Google Sheets của mình, thiết kế dashboard và xem trên web, điện thoại. Dịch vụ hiện là{" "}
          <strong>bản thử nghiệm miễn phí</strong>: tính năng có thể thay đổi, thêm bớt hoặc ngừng, và chúng tôi không cam kết mức
          độ sẵn sàng (không có SLA). Nếu sau này có tính phí, chúng tôi sẽ thông báo trước và bạn có quyền không tiếp tục dùng.
        </p>
      </Section>

      <Section id="tai-khoan" title="3. Tài khoản">
        <ul>
          <li>Bạn đăng nhập bằng tài khoản Google và phải từ 16 tuổi trở lên.</li>
          <li>Bạn chịu trách nhiệm về hoạt động dưới tài khoản của mình và về việc giữ an toàn cho tài khoản Google đó.</li>
          <li>Thông tin bạn cung cấp phải chính xác. Hãy báo cho chúng tôi nếu nghi ngờ tài khoản bị truy cập trái phép.</li>
        </ul>
      </Section>

      <Section id="han-muc" title="4. Hạn mức sử dụng (bản miễn phí)">
        <p>Để bảo đảm công bằng và giữ chi phí hợp lý, hiện áp dụng các giới hạn sau (có thể thay đổi):</p>
        <ul>
          <li>Tối đa {MAX_DASHBOARDS_PER_WORKSPACE} dashboard và {MAX_SOURCES_PER_WORKSPACE} nguồn dữ liệu mỗi tài khoản.</li>
          <li>
            Mỗi nguồn đọc tối đa {vn(MAX_ROWS)} dòng và {MAX_COLUMNS} cột, đồng thời tổng số ô (dòng × cột) không quá {vn(MAX_CELLS)}
            (sheet nhiều cột thì số dòng được đọc ít đi); phần vượt quá sẽ bị bỏ qua.
          </li>
          <li>Tổng số dòng dữ liệu của tất cả nguồn trong một tài khoản tối đa {vn(MAX_ROWS_PER_WORKSPACE)} dòng.</li>
          <li>Tối đa {MAX_PAGES} trang trong một dashboard; mỗi dashboard tối đa 2 MB dữ liệu cấu trúc.</li>
          <li>Ảnh tải lên: tối đa 15 MB mỗi ảnh gốc (được nén lại, tối đa 5 MB sau khi nén).</li>
          <li>Dữ liệu Google Sheets tự cập nhật mỗi {AUTO_SYNC_MINUTES / 60} giờ; có thể bấm cập nhật thủ công nhưng bị giới hạn tần suất.</li>
          <li>Trợ lý AI bị giới hạn số yêu cầu mỗi phút để chống lạm dụng.</li>
        </ul>
      </Section>

      <Section id="du-lieu" title="5. Dữ liệu của bạn">
        <ul>
          <li><strong>Bạn giữ toàn quyền sở hữu</strong> dữ liệu, dashboard và ảnh của mình. Chúng tôi không nhận quyền sở hữu nào.</li>
          <li>
            Bạn cấp cho chúng tôi quyền hạn chế, không độc quyền, để lưu trữ, xử lý và hiển thị nội dung đó{" "}
            <strong>chỉ nhằm vận hành Dịch vụ cho bạn</strong> (đọc từ Google Sheets, vẽ biểu đồ, làm mới dữ liệu, chạy tính năng bạn bật).
          </li>
          <li>
            Bạn bảo đảm mình có quyền dùng dữ liệu và ảnh mà bạn đưa vào Dịch vụ, và việc đó không vi phạm pháp luật, hợp đồng bảo mật
            hay quyền của người khác (bao gồm dữ liệu cá nhân của bên thứ ba).
          </li>
          <li>Cách chúng tôi xử lý dữ liệu, kể cả dữ liệu từ Google, được nêu ở <Link href="/privacy">Chính sách quyền riêng tư</Link>.</li>
        </ul>
      </Section>

      <Section id="cam" title="6. Hành vi không được phép">
        <ul>
          <li>Vi phạm pháp luật, hoặc tải lên nội dung vi phạm quyền sở hữu trí tuệ, quyền riêng tư của người khác.</li>
          <li>Tải lên hoặc phát tán mã độc, nội dung lừa đảo, nội dung bất hợp pháp hoặc xâm hại.</li>
          <li>Dò quét lỗ hổng, vượt qua hạn mức hoặc cơ chế bảo mật, gây quá tải hay làm gián đoạn Dịch vụ.</li>
          <li>Truy cập dữ liệu của người dùng khác, hoặc dùng tự động hóa (bot, kịch bản) để lạm dụng Dịch vụ và các API của nó.</li>
          <li>Dùng Dịch vụ để gửi dữ liệu nhạy cảm mà bạn không có quyền xử lý (ví dụ số thẻ thanh toán, hồ sơ y tế).</li>
          <li>Sao chép, bán lại hoặc dịch ngược Dịch vụ, trừ phần pháp luật cho phép.</li>
        </ul>
      </Section>

      <Section id="ai" title="7. Trợ lý AI">
        <p>
          Trợ lý AI có thể trả lời sai, thiếu hoặc hiểu nhầm dữ liệu. <strong>Hãy tự kiểm chứng</strong> trước khi dựa vào kết quả cho
          quyết định quan trọng (tài chính, pháp lý, y tế...). Khi bạn cho phép AI sửa dashboard, các thay đổi áp dụng lên dashboard
          của bạn và có thể hoàn tác. Dữ liệu gửi cho AI được mô tả ở mục 5 của Chính sách quyền riêng tư.
        </p>
      </Section>

      <Section id="ben-thu-ba" title="8. Dịch vụ của bên thứ ba">
        <p>
          Dịch vụ dùng Google (đăng nhập, Picker, Sheets), Supabase và nhà cung cấp AI. Việc bạn dùng các dịch vụ đó còn chịu điều khoản
          riêng của họ. Chúng tôi không chịu trách nhiệm nếu bên thứ ba thay đổi, giới hạn hoặc ngừng dịch vụ.
        </p>
      </Section>

      <Section id="so-huu-tri-tue" title="9. Quyền sở hữu trí tuệ của Dịch vụ">
        <p>
          Phần mềm, giao diện, nhãn hiệu và nội dung do chúng tôi tạo ra thuộc về chúng tôi hoặc bên cấp phép. Bạn được quyền sử dụng
          Dịch vụ theo các điều khoản này, không được sao chép hay khai thác ngoài phạm vi đó.
        </p>
      </Section>

      <Section id="mien-tru" title="10. Miễn trừ bảo đảm">
        <p>
          Dịch vụ được cung cấp “nguyên trạng” và “như hiện có”. Trong phạm vi pháp luật cho phép, chúng tôi không bảo đảm Dịch vụ không
          gián đoạn, không lỗi, hay dữ liệu hiển thị luôn chính xác và mới nhất (dữ liệu phụ thuộc vào file Google Sheets của bạn và chu
          kỳ cập nhật). Bạn nên giữ bản gốc dữ liệu của mình trong Google Sheets và xuất dashboard ra file khi cần.
        </p>
      </Section>

      <Section id="trach-nhiem" title="11. Giới hạn trách nhiệm">
        <p>
          Trong phạm vi pháp luật cho phép, chúng tôi không chịu trách nhiệm về thiệt hại gián tiếp, ngẫu nhiên, mất lợi nhuận, mất dữ
          liệu hay gián đoạn kinh doanh phát sinh từ việc dùng hoặc không dùng được Dịch vụ. Với Dịch vụ miễn phí, tổng trách nhiệm của
          chúng tôi đối với bạn (nếu có) không vượt quá mức pháp luật bắt buộc. Điều khoản này không loại trừ trách nhiệm mà pháp luật
          không cho phép loại trừ.
        </p>
      </Section>

      <Section id="cham-dut" title="12. Tạm ngừng và chấm dứt">
        <ul>
          <li>Bạn có thể ngừng dùng bất cứ lúc nào, xóa dashboard của mình và yêu cầu xóa tài khoản (xem Chính sách quyền riêng tư).</li>
          <li>Chúng tôi có thể tạm ngừng hoặc chấm dứt quyền truy cập nếu bạn vi phạm điều khoản này, gây rủi ro cho Dịch vụ hoặc người dùng khác, hoặc khi pháp luật yêu cầu. Trừ trường hợp khẩn cấp, chúng tôi sẽ cố gắng thông báo trước.</li>
          <li>Khi chấm dứt, bạn nên xuất dashboard cần giữ; dữ liệu được xử lý theo mục 7 của Chính sách quyền riêng tư.</li>
        </ul>
      </Section>

      <Section id="thay-doi" title="13. Thay đổi điều khoản">
        <p>
          Chúng tôi có thể cập nhật điều khoản này. Thay đổi quan trọng sẽ được thông báo trong ứng dụng hoặc qua email trước khi áp dụng.
          Tiếp tục sử dụng sau ngày áp dụng nghĩa là bạn chấp nhận điều khoản mới; nếu không đồng ý, hãy ngừng dùng Dịch vụ.
        </p>
      </Section>

      <Section id="luat" title="14. Luật áp dụng và giải quyết tranh chấp">
        <p>
          Điều khoản này chịu sự điều chỉnh của pháp luật Việt Nam. Hai bên ưu tiên thương lượng thiện chí; nếu không giải quyết được,
          tranh chấp thuộc thẩm quyền của tòa án có thẩm quyền tại Việt Nam.
        </p>
      </Section>

      <Section id="lien-he" title="15. Liên hệ">
        <p>
          Câu hỏi về điều khoản: <a href={`mailto:${mail}`}>{mail}</a>. Đơn vị vận hành: {site.legal.operator}.
        </p>
      </Section>
    </LegalShell>
  );
}
