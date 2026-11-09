/** Giới hạn tần suất đơn giản theo khoá (thường là IP), lưu trong bộ nhớ của tiến trình. */
export function createRateLimiter(maxPerWindow: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return function limited(key: string): boolean {
    const now = Date.now();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const cur = hits.get(key);
    if (!cur || cur.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      return false;
    }
    cur.n += 1;
    return cur.n > maxPerWindow;
  };
}

export const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
