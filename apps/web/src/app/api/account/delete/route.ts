import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revokeGoogleAccess } from "@/lib/google/api";
import { confirmMatches, sameOrigin } from "@/lib/account-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IMAGE_BUCKET = "dashboard-images";

/** Xóa mọi file ảnh người dùng đã tải lên (thư mục mang id của họ). Storage không tự xóa dây chuyền theo tài khoản. */
async function deleteUserImages(userId: string): Promise<void> {
  const storage = createAdminClient().storage.from(IMAGE_BUCKET);
  for (let guard = 0; guard < 50; guard++) {
    const { data, error } = await storage.list(userId, { limit: 100 });
    if (error) throw new Error(`Không liệt kê được ảnh: ${error.message}`);
    if (!data || data.length === 0) return;
    const { error: rmErr } = await storage.remove(data.map((f) => `${userId}/${f.name}`));
    if (rmErr) throw new Error(`Không xóa được ảnh: ${rmErr.message}`);
    if (data.length < 100) return;
  }
}

/**
 * Xóa tài khoản và TOÀN BỘ dữ liệu của người dùng (không khôi phục được):
 * thu hồi quyền Google → xóa ảnh đã tải lên → xóa tài khoản (cơ sở dữ liệu tự xóa dây chuyền: workspace, dashboard,
 * nguồn dữ liệu và bản sao dòng, token Google, thiết bị...). Không đụng tới file Google Sheets của người dùng.
 * Thao tác nguy hiểm nên: cần phiên đăng nhập, phải gõ lại đúng email, và chặn yêu cầu từ trang web khác.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 });
  }
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return NextResponse.json({ error: "Yêu cầu không hợp lệ." }, { status: 415 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  if (!confirmMatches(user.email, body?.confirm)) {
    return NextResponse.json({ error: "Email xác nhận không khớp với tài khoản của bạn." }, { status: 400 });
  }

  try {
    await revokeGoogleAccess(user.id); // làm hết sức, không chặn việc xóa nếu thất bại
    await deleteUserImages(user.id);
    const { error } = await createAdminClient().auth.admin.deleteUser(user.id);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error("[api/account/delete] thất bại:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: "Chưa xóa xong tài khoản do lỗi hệ thống. Bạn thử lại sau, hoặc liên hệ chúng tôi để được xóa giúp." },
      { status: 500 },
    );
  }

  // Phiên đăng nhập hiện tại không còn hợp lệ: xóa cookie phía server.
  await supabase.auth.signOut().catch(() => {});
  return NextResponse.json({ ok: true });
}
