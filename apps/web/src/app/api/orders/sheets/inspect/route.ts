import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/account-utils";
import { GoogleAuthError, getAccessToken, isValidSpreadsheetId } from "@/lib/google/api";
import { ORDER_COLUMNS } from "@/lib/orders/canonical";
import { buildPreview } from "@/lib/orders/preview";
import { requireEditor } from "@/lib/orders/request";
import { sheetLinkedTo } from "@/lib/orders/sheet-link";
import { SheetSyncError, inspectOrderSheet } from "@/lib/orders/sheet-sync";
import { createRateLimiter } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limited = createRateLimiter(30, 10 * 60 * 1000);

/**
 * Xem trước một tab Google Sheet làm nguồn đơn hàng, KHÔNG ghi gì: nhận diện sàn và cột, tóm tắt, cảnh báo (dòng trùng, mã đơn hỏng...)
 * và vài dòng đã chuẩn hoá. Body JSON: {spreadsheetId, sheetName, channel?, mapping?}.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers.get("origin"), request.headers.get("host"))) return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 403 });
  const auth = await requireEditor();
  if (!auth.ok) return auth.response;
  if (limited(auth.user.id)) return NextResponse.json({ error: "Bạn thao tác quá nhanh, thử lại sau ít phút." }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { spreadsheetId?: unknown; sheetName?: unknown; channel?: unknown; mapping?: unknown } | null;
  const sheetName = typeof body?.sheetName === "string" ? body.sheetName.trim() : "";
  if (!isValidSpreadsheetId(body?.spreadsheetId) || !sheetName || sheetName.length > 120) return NextResponse.json({ error: "Thiếu hoặc sai thông tin file/tab" }, { status: 400 });
  if (JSON.stringify(body?.mapping ?? null).length > 4000) return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });

  try {
    const token = await getAccessToken(auth.user.id);
    const { prepared: p, rows } = await inspectOrderSheet({ token, spreadsheetId: body.spreadsheetId, sheetName, channel: body?.channel, mapping: body?.mapping });
    const linked = p.channel ? await sheetLinkedTo(auth.supabase, auth.workspaceId, p.channel) : null;
    return NextResponse.json({
      sheetName,
      rows,
      headers: p.headers,
      profile: p.profile,
      profileLabel: p.profileLabel,
      channel: p.channel,
      mapping: p.mapping,
      problems: linked ? [...p.problems, `Kênh ${p.channel} đã nối với Sheet "${linked}". Mỗi kênh chỉ nối một Sheet: hãy ngắt kết nối Sheet cũ trước.`] : p.problems,
      columns: ORDER_COLUMNS.map((c) => c.name),
      duplicates: p.duplicates,
      ...buildPreview(p.normalized),
    });
  } catch (e) {
    if (e instanceof GoogleAuthError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof SheetSyncError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Không đọc được Sheet." }, { status: 502 });
  }
}
