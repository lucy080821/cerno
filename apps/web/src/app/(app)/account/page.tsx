import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { site } from "@/lib/site";
import { Brand } from "@/components/Brand";
import { DeleteAccount } from "./DeleteAccount";
import styles from "./account.module.css";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ count: dashboards }, { count: sources }] = await Promise.all([
    supabase.from("dashboards").select("id", { count: "exact", head: true }),
    supabase.from("data_sources").select("id", { count: "exact", head: true }),
  ]);

  const name = (user.user_metadata?.full_name as string | undefined) ?? "";

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <Link href="/dashboards" className={styles.back}>← Quay lại danh sách dashboard</Link>
        <span className={styles.brand}><Brand size={22} tone="strong" /></span>
      </header>

      <h1>Tài khoản</h1>
      <section className={styles.card}>
        <div className={styles.row}><span>Tên</span><strong>{name || "—"}</strong></div>
        <div className={styles.row}><span>Email</span><strong>{user.email}</strong></div>
        <div className={styles.row}><span>Đăng nhập bằng</span><strong>Google</strong></div>
        <div className={styles.row}><span>Dashboard</span><strong>{dashboards ?? 0}</strong></div>
        <div className={styles.row}><span>Nguồn dữ liệu</span><strong>{sources ?? 0}</strong></div>
      </section>

      <section className={styles.danger} aria-labelledby="xoa-tk">
        <h2 id="xoa-tk">Xóa tài khoản</h2>
        <p>Thao tác này <strong>không thể khôi phục</strong>. Chúng tôi sẽ xóa ngay:</p>
        <ul>
          <li>toàn bộ dashboard của bạn;</li>
          <li>mọi nguồn dữ liệu và bản sao dữ liệu Google Sheets đã lưu;</li>
          <li>ảnh bạn đã tải lên;</li>
          <li>quyền truy cập Google đã cấp cho {site.name} (đồng thời thu hồi ở phía Google);</li>
          <li>tài khoản đăng nhập của bạn.</li>
        </ul>
        <p>
          <strong>Các file Google Sheets gốc của bạn không bị ảnh hưởng</strong>, vì {site.name} chỉ đọc chúng. Nếu muốn giữ lại
          dashboard, hãy xuất ra file JSON trong editor trước khi xóa.
        </p>
        <DeleteAccount email={user.email ?? ""} />
      </section>

      <p className={styles.fine}>
        Xem thêm <Link href="/privacy">Chính sách quyền riêng tư</Link> và <Link href="/terms">Điều khoản sử dụng</Link>.
      </p>
    </main>
  );
}
