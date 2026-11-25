"use client";

/** Lỗi ở tầng ngoài cùng (ví dụ khung trang hoặc thanh bên bị lỗi): màn hình thân thiện có nút tải lại thay vì chữ "Application error". */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="vi">
      <body style={{ margin: 0, background: "#f4f5fa", color: "#14162b", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 480, margin: "18vh auto 0", padding: "0 20px", textAlign: "center" }}>
          <h1 style={{ fontSize: 20, marginBottom: 10 }}>Cerno gặp lỗi khi tải trang</h1>
          <p style={{ color: "#5d6782", lineHeight: 1.6, marginBottom: 20 }}>
            Có thể do hệ thống vừa cập nhật phiên bản mới. Hãy tải lại trang; nếu vẫn lỗi, bạn thử lại sau ít phút.
          </p>
          <p style={{ color: "#5d6782", lineHeight: 1.6, marginBottom: 20, fontSize: 13 }}>
            Cerno hit an error while loading. The app may have just been updated: reload the page, or try again in a few minutes.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ border: 0, borderRadius: 10, padding: "10px 20px", background: "#6d5efc", color: "#fff", fontWeight: 600, cursor: "pointer", marginRight: 8 }}
          >
            Tải lại trang
          </button>
          <button
            type="button"
            onClick={reset}
            style={{ border: "1px solid rgba(20,22,43,.2)", borderRadius: 10, padding: "10px 20px", background: "transparent", cursor: "pointer" }}
          >
            Thử lại
          </button>
        </div>
      </body>
    </html>
  );
}
