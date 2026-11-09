import Link from "next/link";
import { LangSwitch } from "@/components/i18n/LangSwitch";
import { Brand } from "@/components/Brand";
import s from "./editor/editor.module.css";

/** Thanh tiêu đề của trang xem chỉ-đọc (link xem công khai, người được mời quyền Xem). */
export function ViewerBar({ name, backHref, editHref }: { name: string; backHref?: string; editHref?: string }) {
  return (
    <header className={s.viewBar}>
      {backHref && <Link href={backHref} className={s.viewBarLink}>← Danh sách</Link>}
      <span className={s.viewBarName} title={name}>{name || "Dashboard"}</span>
      {editHref && <Link href={editHref} className={s.viewBarLink}>Chỉnh sửa</Link>}
      <LangSwitch />
      <Link href="/" className={s.viewBarBrand} target="_blank" rel="noopener">Tạo bằng <Brand size={16} gap={5} tone="inherit" /></Link>
    </header>
  );
}
