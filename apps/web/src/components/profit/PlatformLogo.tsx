import styles from "./profit.module.css";

/** Logo (nền trong suốt) của các sàn có ảnh; sàn khác hiện nhãn chữ. Ảnh ở public/img/channels. */
const LOGOS: Record<string, { src: string; width: number; height: number }> = {
  Shopee: { src: "/img/channels/shopee.webp", width: 376, height: 128 },
  "TikTok Shop": { src: "/img/channels/tiktok-shop.webp", width: 616, height: 110 },
};

/** Tên kênh dạng logo nếu có, không thì nhãn chữ như cũ. Tên kênh là dữ liệu nên không dịch. */
export function PlatformLogo({ channel }: { channel: string }) {
  const logo = LOGOS[channel];
  if (!logo) {
    return (
      <span className={styles.platformTag} data-platform={channel} data-i18n-skip>
        {channel}
      </span>
    );
  }
  return (
    <span className={`${styles.platformTag} ${styles.platformLogo}`} data-platform={channel} data-i18n-skip>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.src} alt={channel} width={logo.width} height={logo.height} loading="lazy" decoding="async" draggable={false} />
    </span>
  );
}
