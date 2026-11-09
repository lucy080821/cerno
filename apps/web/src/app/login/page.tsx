import Link from "next/link";
import { LangSwitch } from "@/components/i18n/LangSwitch";
import { Brand } from "@/components/Brand";
import { safeNext } from "@/lib/auth/next";
import { LoginButton } from "./LoginButton";
import styles from "./login.module.css";

const ERRORS: Record<string, string> = {
  config: "Chưa cấu hình Supabase (thiếu NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).",
  no_code: "Đăng nhập bị huỷ hoặc thiếu mã xác thực. Thử lại nhé.",
  exchange: "Không đăng nhập được. Thử lại nhé.",
  token_store: "Đăng nhập được nhưng chưa lưu được quyền Google (kiểm tra TOKEN_ENCRYPTION_KEY, SUPABASE_SERVICE_ROLE_KEY).",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; deleted?: string; next?: string }> }) {
  const { error, deleted, next } = await searchParams;
  return (
    <main className={styles.wrap}>
      <LangSwitch floating />
      <div className={styles.card}>
        <Link href="/" className={styles.brand}><Brand size={30} tone="strong" /></Link>
        <h1>Đăng nhập</h1>
        <p className={styles.sub}>
          Dùng tài khoản Google để vào. Cùng một lần đăng nhập, bạn có thể chọn file Google Sheets làm nguồn dữ liệu.
        </p>
        {deleted && <p className={styles.notice} role="status">Đã xóa tài khoản và toàn bộ dữ liệu của bạn.</p>}
        {error && <p className={styles.error} role="alert">{ERRORS[error] ?? "Có lỗi xảy ra."}</p>}
        <LoginButton next={safeNext(next) ?? undefined} />
        <p className={styles.fine}>
          Chúng tôi chỉ truy cập các file bạn chọn (quyền <code>drive.file</code>), không xem được phần còn lại của Drive.
        </p>
        <p className={styles.fine}>
          Bằng việc đăng nhập, bạn đồng ý với <Link href="/terms">Điều khoản sử dụng</Link> và{" "}
          <Link href="/privacy">Chính sách quyền riêng tư</Link>.
        </p>
      </div>
    </main>
  );
}
