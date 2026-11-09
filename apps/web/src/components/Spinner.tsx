/** Vòng quay chờ tải. Style ở globals.css (.spinner), dùng được cả ở server component. */
export function Spinner({ size = 28, label, inline = false }: { size?: number; label?: string; inline?: boolean }) {
  // Biến thể `inline`: chỉ vòng quay nhỏ, đặt trước chữ trong nút hoặc dòng thông báo.
  if (inline) {
    return <span className="spinner spinnerInline" style={{ width: size, height: size }} role="status" aria-label="Đang xử lý" />;
  }
  return (
    <span className="spinnerWrap" role="status" aria-live="polite">
      <span className="spinner" style={{ width: size, height: size }} aria-hidden />
      {label ? <span className="spinnerLabel">{label}</span> : <span className="srOnly">Đang tải…</span>}
    </span>
  );
}

/** Toàn màn hình, dùng cho loading.tsx của route. */
export function FullPageSpinner({ label = "Đang tải…" }: { label?: string }) {
  return (
    <div className="fullSpinner">
      <Spinner size={36} label={label} />
    </div>
  );
}
