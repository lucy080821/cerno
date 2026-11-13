import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { LangSwitch } from "@/components/i18n/LangSwitch";
import legal from "@/components/legal/legal.module.css";
import u from "@/components/upgrade/upgrade.module.css";
import { PLAN_LIMITS } from "@/lib/limits";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `Gói Miễn phí và Trả phí | ${site.name}`,
  description: `So sánh gói Miễn phí và Trả phí của ${site.name}.`,
};

const FREQ: Record<string, string> = { daily: "Hằng ngày", weekly: "Hằng tuần", monthly: "Hằng tháng" };

export default function UpgradePage() {
  const f = PLAN_LIMITS.free;
  const p = PLAN_LIMITS.paid;
  const mail = site.legal.contactEmail;
  const mailOk = !mail.startsWith("[");
  const mailto = `mailto:${mail}?subject=${encodeURIComponent("Nâng cấp gói Trả phí")}`;

  const rows: [string, string, string][] = [
    ["Người nhận báo cáo email mỗi dashboard", `${f.reportSubscriptions} người`, `${p.reportSubscriptions} người`],
    ["Tần suất báo cáo", f.reportFrequencies.map((x) => FREQ[x]).join(", "), p.reportFrequencies.map((x) => FREQ[x]).join(", ")],
    ["Phân tích do AI viết trong báo cáo", "Không (chỉ bảng số và biểu đồ)", "Có, theo yêu cầu riêng của từng người nhận"],
    ["Cảnh báo mỗi dashboard", `${f.alertRules} cảnh báo`, `${p.alertRules} cảnh báo`],
    ["Loại cảnh báo", "Vượt ngưỡng, thay đổi so với kỳ trước", "Cả 5 loại: thêm bất thường, không có dữ liệu mới, theo từng nhóm"],
    ["Tạo cảnh báo bằng AI", `${f.aiAlertParsePerMonth} lần mỗi tháng`, "Không giới hạn"],
    ["Email gửi đi mỗi ngày (báo cáo và cảnh báo)", `${f.mailsPerDay} email`, `${p.mailsPerDay} email`],
  ];

  return (
    <div className={legal.page}>
      <header className={legal.top}>
        <Link href="/" className={legal.brand}><Brand size={24} /></Link>
        <LangSwitch />
      </header>
      <main className={legal.article}>
        <div className={u.hero}>
          <h1>Gói Miễn phí và Trả phí</h1>
          <p>
            <strong>Hãy dùng thử gói Miễn phí trước.</strong> Gói này đã đủ để tạo dashboard từ Google Sheets, nhận báo cáo hằng
            tuần qua email và đặt cảnh báo cơ bản. Khi thấy cần thêm, bạn hãy nâng cấp.
          </p>
        </div>

        <div className={u.tableWrap}>
          <table className={u.table}>
            <thead>
              <tr>
                <th scope="col">Tính năng</th>
                <th scope="col">Miễn phí</th>
                <th scope="col" className={u.paid}>Trả phí</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, free, paid]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{free}</td>
                  <td className={u.paid}>{paid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p style={{ marginTop: 18, color: "var(--muted)" }}>
          Hiện chưa có thanh toán trực tuyến: chúng tôi nâng cấp tài khoản thủ công sau khi bạn liên hệ. Gửi kèm email bạn dùng
          để đăng nhập để chúng tôi nâng cấp đúng tài khoản.
        </p>

        <div className={u.cta}>
          {mailOk ? (
            <a className={`${u.btn} ${u.big}`} href={mailto}>Liên hệ để nâng cấp</a>
          ) : (
            <span className={`${u.btn} ${u.big}`}>Chưa cấu hình email liên hệ</span>
          )}
          <Link className={u.ghost} href="/dashboards">Tiếp tục dùng thử miễn phí</Link>
        </div>
        {mailOk && <p style={{ marginTop: 10, color: "var(--muted)", fontSize: "0.9rem" }}>Email liên hệ: {mail}</p>}
      </main>
    </div>
  );
}
