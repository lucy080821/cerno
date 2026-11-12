import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { LangSwitch } from "@/components/i18n/LangSwitch";
import { verifyNotifyToken } from "@/lib/server/notify/unsubscribe";
import { UnsubscribeForm } from "./UnsubscribeForm";
import styles from "./unsubscribe.module.css";

// Trang riêng tư theo từng email: không để công cụ tìm kiếm lập chỉ mục, không gửi Referer đi nơi khác.
export const metadata: Metadata = { title: "Huỷ nhận email", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** an***@gmail.com: đủ để người nhận nhận ra email của mình mà không lộ đầy đủ cho người lạ mở nhầm link. */
function mask(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}***@${domain}`;
}

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const token = verifyNotifyToken(t);
  // Báo cáo định kỳ chỉ có "huỷ nhận"; cảnh báo có thêm "tạm hoãn" và "tắt".
  const supported = !!token && (token.a === "unsub" || token.k === "alert");

  return (
    <main className={styles.page}>
      <div className={styles.lang}><LangSwitch /></div>
      <section className={styles.card}>
        <Brand size={26} tone="strong" />
        {token && t && supported ? (
          token.a === "snooze" ? (
            <>
              <h1>Tạm hoãn cảnh báo</h1>
              <p>{`Bạn muốn tạm dừng cảnh báo này trong 24 giờ? Sau đó cảnh báo sẽ tự hoạt động lại (gửi tới ${mask(token.e)}).`}</p>
              <UnsubscribeForm token={t} action="snooze" />
            </>
          ) : token.a === "mute" ? (
            <>
              <h1>Tắt cảnh báo</h1>
              <p>{`Bạn muốn tắt cảnh báo này? Bạn sẽ không nhận thêm email của cảnh báo này tại ${mask(token.e)}.`}</p>
              <UnsubscribeForm token={t} action="mute" />
            </>
          ) : (
            <>
              <h1>Huỷ nhận email</h1>
              <p>
                {token.k === "report"
                  ? `Bạn muốn ngừng nhận báo cáo định kỳ này gửi tới ${mask(token.e)}?`
                  : `Bạn muốn ngừng nhận cảnh báo này gửi tới ${mask(token.e)}?`}
              </p>
              <UnsubscribeForm token={t} action="unsub" />
            </>
          )
        ) : token ? (
          <>
            <h1>Link chưa được hỗ trợ</h1>
            <p>Thao tác trong link này chưa dùng được.</p>
          </>
        ) : (
          <>
            <h1>Link không hợp lệ</h1>
            <p>Link này sai hoặc đã hết hạn. Nếu muốn ngừng nhận email, hãy dùng link ở cuối email gần nhất bạn nhận được.</p>
          </>
        )}
        <p><Link href="/">Về trang chủ</Link></p>
      </section>
    </main>
  );
}
