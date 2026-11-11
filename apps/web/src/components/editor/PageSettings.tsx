"use client";

import { getPageIcon, PAGE_ICONS } from "@/lib/editor/page-icons";
import { getPages, resolvePageId } from "@dashboard/schema";
import { useEditor } from "@/lib/editor/store";
import { ColorField, NumField, Section, SelectField, TextField, Toggle } from "./fields";
import { ImageUpload } from "./ImageUpload";
import { PageNav } from "./PageNav";
import s from "./editor.module.css";

/** Cài đặt trang hiện tại + kiểu thanh danh sách trang và hiệu ứng chuyển trang. Hiện khi không chọn widget nào. */
export function PageSettings() {
  const doc = useEditor((st) => st.doc);
  const pageId = useEditor((st) => resolvePageId(st.doc, st.pageId));
  const patchPage = useEditor((st) => st.patchPage);
  const patchNav = useEditor((st) => st.patchNav);

  const pages = getPages(doc);
  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  const nav = doc.nav;

  return (
    <>
      <Section title="Trang hiện tại">
        <TextField label="Tên trang" value={page.name} onChange={(v) => patchPage(page.id, { name: v.slice(0, 80) }, "pname")} />
        <ColorField label="Màu nền trang" value={page.background} clearable emptyLabel="Theo canvas"
          onChange={(v) => patchPage(page.id, { background: v }, "pbg")} />
        <span className={s.label}>Icon trang</span>
        <div className={s.iconPicker}>
          {[...new Set(PAGE_ICONS.map((i) => i.group))].map((g) => (
            <div key={g}>
              <div className={s.iconGroup}>{g}</div>
              <div className={s.iconGrid} role="radiogroup" aria-label={`Icon: ${g}`}>
                {PAGE_ICONS.filter((i) => i.group === g).map((i) => (
                  <button
                    key={i.key}
                    role="radio"
                    aria-checked={getPageIcon(page.icon).key === i.key}
                    aria-label={i.label}
                    title={i.label}
                    className={`${s.iconBtn} ${getPageIcon(page.icon).key === i.key ? s.iconBtnOn : ""}`}
                    onClick={() => patchPage(page.id, { icon: i.key === "page" ? undefined : i.key })}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      {i.paths.map((d, k) => <path key={k} d={d} />)}
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Thanh trang và chuyển trang">
        <Toggle label="Hiện thanh trang khi xem" value={nav.show} onChange={(v) => patchNav({ show: v })} />
        <div className={s.two}>
          <NumField label="Độ rộng" value={nav.width} min={120} max={360} suffix="px"
            onChange={(v) => patchNav({ width: Math.min(360, Math.max(120, v)) }, "nav-w")} />
          <NumField label="Cỡ chữ" value={nav.fontSize} min={10} max={24} suffix="px"
            onChange={(v) => patchNav({ fontSize: Math.min(24, Math.max(10, v)) }, "nav-fs")} />
          <NumField label="Bo góc" value={nav.radius} min={0} max={24} suffix="px"
            onChange={(v) => patchNav({ radius: Math.min(24, Math.max(0, v)) }, "nav-r")} />
        </div>
        <ColorField label="Màu nền thanh" value={nav.background} onChange={(v) => patchNav({ background: v ?? nav.background }, "nav-bg")} />
        <ColorField label="Màu chữ" value={nav.textColor} onChange={(v) => patchNav({ textColor: v ?? nav.textColor }, "nav-tc")} />
        <ColorField label="Màu chữ trang đang chọn" value={nav.activeColor} onChange={(v) => patchNav({ activeColor: v ?? nav.activeColor }, "nav-ac")} />
        <ColorField label="Màu nền trang đang chọn" value={nav.activeBackground} onChange={(v) => patchNav({ activeBackground: v ?? nav.activeBackground }, "nav-ab")} />
        <Toggle label="In đậm tên trang" value={nav.bold} onChange={(v) => patchNav({ bold: v })} />
        <Toggle label="Hiện tên dashboard ở đầu thanh" value={nav.showTitle} onChange={(v) => patchNav({ showTitle: v })} />
        {nav.showTitle && (
          <>
            <span className={s.label}>Logo / icon cạnh tên dashboard</span>
            <ImageUpload url={nav.logo ?? ""} onUrl={(url) => patchNav({ logo: url })} />
            {nav.logo && (
              <button className={s.hint} style={{ textAlign: "left", cursor: "pointer", background: "none", border: 0, padding: 0, textDecoration: "underline" }}
                onClick={() => patchNav({ logo: undefined })}>
                Bỏ logo, dùng icon mặc định
              </button>
            )}
          </>
        )}
        <SelectField label="Hiệu ứng chuyển trang" value={nav.transition}
          options={[
            { value: "slide", label: "Trượt ngang" },
            { value: "slideUp", label: "Trượt dọc" },
            { value: "fade", label: "Mờ dần" },
            { value: "zoomIn", label: "Phóng to vào" },
            { value: "zoomOut", label: "Thu nhỏ vào" },
            { value: "flip", label: "Lật ngang" },
            { value: "flipX", label: "Lật dọc" },
            { value: "cube", label: "Xoay khối 3D" },
            { value: "rotate", label: "Xoay và phóng" },
            { value: "blur", label: "Nhoè rồi nét" },
            { value: "wipe", label: "Quét mở" },
            { value: "drop", label: "Rơi xuống" },
            { value: "bounce", label: "Nảy" },
            { value: "none", label: "Không có" },
          ]}
          onChange={(v) => patchNav({ transition: v })} />
        <span className={s.label}>Xem thử</span>
        <div className={s.navPreviewBox}>
          <PageNav embedded />
        </div>
        <p className={s.hint}>Thanh trang chỉ hiện khi Xem trước / Toàn màn hình và dashboard có từ 2 trang. Dùng phím ← → để chuyển trang.</p>
      </Section>
    </>
  );
}
