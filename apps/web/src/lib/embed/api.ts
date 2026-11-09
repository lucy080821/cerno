import { createClient } from "@/lib/supabase/client";

/**
 * fetch cho các API chia sẻ: nếu máy chủ trả 401 (phiên vừa hết hạn / làm mới chưa kịp) hoặc 503 (mạng tới máy chủ
 * đăng nhập chập chờn), làm mới phiên ở trình duyệt rồi thử lại một lần trước khi báo lỗi cho người dùng.
 */
async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 401 && res.status !== 503) return res;
  try {
    await createClient().auth.refreshSession();
  } catch {
    /* không làm mới được thì vẫn thử lại: lỗi thật sẽ hiện ở lần sau */
  }
  await new Promise((r) => setTimeout(r, 400));
  return fetch(url, init);
}

/** Gọi API cài đặt chia sẻ/nhúng của một dashboard (xem app/api/dashboards/[id]/share/route.ts). */

export interface ShareState {
  enabled: boolean;
  token: string | null;
  domains: string[];
}

async function call(id: string, init?: RequestInit): Promise<ShareState> {
  const res = await apiFetch(`/api/dashboards/${id}/share`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const json = (await res.json().catch(() => ({}))) as Partial<ShareState> & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Có lỗi xảy ra, thử lại sau.");
  return { enabled: !!json.enabled, token: json.token ?? null, domains: json.domains ?? [] };
}

export const getShare = (id: string) => call(id);
export const enableShare = (id: string) => call(id, { method: "POST", body: JSON.stringify({ action: "enable" }) });
export const rotateShare = (id: string) => call(id, { method: "POST", body: JSON.stringify({ action: "rotate" }) });
export const disableShare = (id: string) => call(id, { method: "POST", body: JSON.stringify({ action: "disable" }) });
export const saveShareDomains = (id: string, domains: string[]) =>
  call(id, { method: "PUT", body: JSON.stringify({ domains }) });

/** Link xem công khai, và đoạn mã iframe để dán vào website. */
export const shareUrl = (origin: string, token: string) => `${origin}/embed/${token}`;
export const iframeCode = (url: string, name: string) =>
  `<iframe src="${url}" title="${name.replace(/["<>&]/g, "")}" width="100%" height="700" style="border:0" loading="lazy" allowfullscreen></iframe>`;

// ---------------------------------------------------------------------------------------------
// Link xem công khai trên Cerno (api/dashboards/[id]/link)

export interface LinkState {
  enabled: boolean;
  token: string | null;
}

async function linkCall(id: string, init?: RequestInit): Promise<LinkState> {
  const res = await apiFetch(`/api/dashboards/${id}/link`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const json = (await res.json().catch(() => ({}))) as Partial<LinkState> & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Có lỗi xảy ra, thử lại sau.");
  return { enabled: !!json.enabled, token: json.token ?? null };
}

export const getLink = (id: string) => linkCall(id);
export const enableLink = (id: string) => linkCall(id, { method: "POST", body: JSON.stringify({ action: "enable" }) });
export const rotateLink = (id: string) => linkCall(id, { method: "POST", body: JSON.stringify({ action: "rotate" }) });
export const disableLink = (id: string) => linkCall(id, { method: "POST", body: JSON.stringify({ action: "disable" }) });
export const viewUrl = (origin: string, token: string) => `${origin}/view/${token}`;

// ---------------------------------------------------------------------------------------------
// Mời theo email (api/dashboards/[id]/access)

export type AccessRole = "viewer" | "editor";
export interface Person {
  email: string;
  role: AccessRole;
}

async function accessCall(id: string, init?: RequestInit): Promise<Person[]> {
  const res = await apiFetch(`/api/dashboards/${id}/access`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const json = (await res.json().catch(() => ({}))) as { people?: Person[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Có lỗi xảy ra, thử lại sau.");
  return json.people ?? [];
}

export const listPeople = (id: string) => accessCall(id);
export const invitePerson = (id: string, email: string, role: AccessRole) =>
  accessCall(id, { method: "POST", body: JSON.stringify({ email, role }) });
export const removePerson = (id: string, email: string) =>
  accessCall(id, { method: "DELETE", body: JSON.stringify({ email }) });

/** Link riêng cho người được mời (cần đăng nhập Google bằng đúng email đã mời). */
export const invitedUrl = (origin: string, id: string, role: AccessRole) =>
  role === "editor" ? `${origin}/editor/${id}` : `${origin}/d/${id}`;
