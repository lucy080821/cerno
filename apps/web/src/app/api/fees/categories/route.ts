import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/server/session-user";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { isSellerType } from "@/lib/fees/constants";
import { searchCategories, tableInfo } from "@/lib/fees/shopee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limited = createRateLimiter(240, 60_000);

/** Tìm ngành hàng trong biểu Phí Cố Định của Shopee: GET ?type=non_mall|mall&q=tai nghe. Cần đăng nhập. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Quá nhiều yêu cầu, thử lại sau ít giây." }, { status: 429 });
  const sp = new URL(req.url).searchParams;
  const type = isSellerType(sp.get("type")) ? (sp.get("type") as "non_mall" | "mall") : "non_mall";
  const q = (sp.get("q") ?? "").slice(0, 80);
  return NextResponse.json(
    { items: searchCategories(type, q, 20), effectiveFrom: tableInfo(type).effectiveFrom },
    { headers: { "cache-control": "private, no-store" } },
  );
}
