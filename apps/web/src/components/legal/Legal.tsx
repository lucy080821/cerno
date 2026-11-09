import Link from "next/link";
import type { ReactNode } from "react";
import { site } from "@/lib/site";
import { Brand } from "@/components/Brand";
import s from "./legal.module.css";

/** Khung chung cho các trang pháp lý (Chính sách quyền riêng tư, Điều khoản): công khai, không cần đăng nhập. */
export function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={s.page}>
      <header className={s.top}>
        <Link href="/" className={s.brand}><Brand size={24} /></Link>
        <nav className={s.nav} aria-label="Trang pháp lý">
          <Link href="/privacy">Quyền riêng tư</Link>
          <Link href="/terms">Điều khoản</Link>
        </nav>
      </header>
      <main className={s.article}>
        <h1>{title}</h1>
        <p className={s.meta}>Cập nhật lần cuối: {site.legal.updated}</p>
        {children}
      </main>
      <footer className={s.footer}>
        © {new Date().getFullYear()} {site.name} · Liên hệ: <a href={`mailto:${site.legal.contactEmail}`}>{site.legal.contactEmail}</a>
      </footer>
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className={s.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Ô nhấn mạnh (vd tuyên bố "Limited Use" của Google). */
export function Callout({ children }: { children: ReactNode }) {
  return <div className={s.callout}>{children}</div>;
}
