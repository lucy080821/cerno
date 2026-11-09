/**
 * Tên miền được phép nhúng dashboard (iframe). Dùng ở server (kiểm tra khi lưu), middleware (đặt header CSP
 * `frame-ancestors`) và UI (báo dòng nhập sai). Thuần tuý, không phụ thuộc Node, chạy được cả ở Edge.
 *
 * Quy ước một mục:
 *  - `congty.com`    → cho nhúng ở congty.com và www.congty.com
 *  - `*.congty.com`  → cho nhúng ở congty.com và mọi tên miền con (app.congty.com, a.b.congty.com...)
 *  - `localhost`     → để thử trên máy (mọi cổng, http hoặc https)
 * Không nhận địa chỉ IP, đường dẫn, cổng, hay ký tự lạ: mọi mục đều được kiểm tra chặt vì chúng được ghép thẳng
 * vào header CSP, nên một ký tự như khoảng trắng hoặc dấu ; sẽ cho phép chèn thêm chỉ thị.
 */

export const MAX_EMBED_DOMAINS = 20;

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const TLD = "(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})";
const HOST_RE = new RegExp(`^(?:${LABEL}\\.)+${TLD}$`);

/** Chuẩn hoá một dòng người dùng nhập. Trả về null nếu không hợp lệ. */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/[/?#].*$/, ""); // bỏ đường dẫn, query
  s = s.replace(/:\d+$/, ""); // bỏ cổng
  s = s.replace(/\.$/, ""); // dấu chấm cuối

  let wildcard = false;
  if (s.startsWith("*.")) {
    wildcard = true;
    s = s.slice(2);
  }
  if (!s) return null;

  if (s === "localhost") return wildcard ? null : "localhost";

  // Tên miền có dấu (IDN) đổi sang punycode bằng bộ phân tích URL chuẩn.
  let host: string;
  try {
    host = new URL(`https://${s}`).hostname;
  } catch {
    return null;
  }
  if (host.length > 253 || !HOST_RE.test(host)) return null;
  // Chỉ chấp nhận khi chuỗi gốc đã là một hostname trơn (không có thứ URL tự sửa như khoảng trắng, @, :).
  if (/[^a-z0-9.\-\u0080-￿]/.test(s)) return null;
  return wildcard ? `*.${host}` : host;
}

export interface ParsedDomains {
  domains: string[];
  /** Các dòng không hợp lệ (nguyên văn), để báo cho người dùng. */
  invalid: string[];
  tooMany: boolean;
}

/** Tách nhiều tên miền (mỗi dòng hoặc cách nhau bằng dấu phẩy/khoảng trắng), bỏ trùng, giữ thứ tự. */
export function parseDomains(text: string): ParsedDomains {
  const out: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    if (!raw.trim()) continue;
    const d = normalizeDomain(raw);
    if (d === null) invalid.push(raw);
    else if (!out.includes(d)) out.push(d);
  }
  return { domains: out, invalid, tooMany: out.length > MAX_EMBED_DOMAINS };
}

/** Giá trị của chỉ thị CSP `frame-ancestors` cho danh sách tên miền (rỗng = không ai nhúng được). */
export function frameAncestors(domains: readonly string[]): string {
  const src: string[] = [];
  for (const raw of domains) {
    // Kiểm tra lại lần nữa dù dữ liệu đã được chuẩn hoá khi lưu: đây là chỗ ghép vào header.
    const d = normalizeDomain(raw);
    if (d === null) continue;
    if (d === "localhost") {
      src.push("http://localhost:*", "https://localhost:*", "http://localhost", "https://localhost");
    } else if (d.startsWith("*.")) {
      src.push(`https://${d.slice(2)}`, `https://${d}`);
    } else {
      src.push(`https://${d}`, `https://www.${d}`);
    }
  }
  const uniq = [...new Set(src)];
  return `frame-ancestors ${uniq.length ? uniq.join(" ") : "'none'"}`;
}
