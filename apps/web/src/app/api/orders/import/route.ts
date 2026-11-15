import { NextResponse, type NextRequest } from "next/server";
import { FileError } from "@/lib/orders/csv";
import { ImportError, importOrders } from "@/lib/orders/import";
import { prepareImport } from "@/lib/orders/prepare";
import { readUpload, requireEditor } from "@/lib/orders/request";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const limited = createRateLimiter(12, 10 * 60 * 1000);

/** Nhập file đơn hàng vào nguồn "Đơn hàng đa kênh" của người dùng (tạo nguồn nếu chưa có, gộp nếu đã có). */
export async function POST(request: NextRequest) {
  const auth = await requireEditor();
  if (!auth.ok) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Bạn thao tác quá nhanh, thử lại sau ít phút." }, { status: 429 });

  const up = await readUpload(request);
  if (up instanceof NextResponse) return up;
  try {
    const prepared = await prepareImport(up.data, up.filename, up.opts);
    if (prepared.problems.length || !prepared.normalized) {
      return NextResponse.json({ error: prepared.problems[0] ?? "File chưa đủ thông tin để nhập.", problems: prepared.problems }, { status: 422 });
    }
    const result = await importOrders({
      user: auth.supabase,
      admin: createAdminClient(),
      userId: auth.user.id,
      workspaceId: auth.workspaceId,
      prepared,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof FileError) return NextResponse.json({ error: e.message }, { status: 422 });
    if (e instanceof ImportError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[api/orders/import]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Không nhập được file." }, { status: 500 });
  }
}
