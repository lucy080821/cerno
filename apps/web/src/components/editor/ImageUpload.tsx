"use client";

import { useRef, useState } from "react";
import { uploadImage } from "@/lib/editor/upload-image";
import { Icon } from "./fields";
import s from "./editor.module.css";
import { Spinner } from "@/components/Spinner";

/** Khung tải ảnh từ máy: bấm để chọn file hoặc kéo-thả ảnh vào. */
export function ImageUpload({ url, onUrl }: { url: string; onUrl: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      onUrl(await uploadImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được ảnh.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = ""; // cho phép chọn lại cùng một file
    }
  };

  return (
    <div>
      <div
        className={`${s.imgDrop} ${over ? s.imgDropOver : ""}`}
        role="button"
        tabIndex={0}
        aria-disabled={busy}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files[0]); }}
      >
        {url && /^https?:\/\//.test(url) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className={s.imgPreview} />
        ) : (
          <Icon name="upload" size={18} />
        )}
        <span>{busy ? <><Spinner size={12} inline />Đang tải lên…</> : url ? "Bấm hoặc kéo ảnh mới vào để thay" : "Bấm để chọn ảnh từ máy, hoặc kéo thả vào đây"}</span>
        <span>PNG, JPG, WebP, GIF · tối đa 15 MB</span>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
        onChange={(e) => void upload(e.target.files?.[0])} />
      {error && <div className={s.imgError} role="alert">{error}</div>}
    </div>
  );
}
