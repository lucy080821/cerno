"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Chọn một Google Sheet bằng Google Picker (scope drive.file: chỉ file người dùng chọn mới đọc được). Chạy ở trình duyệt. */
declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

let pickerReady: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  pickerReady ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.onload = () => window.gapi.load("picker", { callback: () => resolve() });
    s.onerror = () => {
      pickerReady = null;
      reject(new Error("Không tải được Google Picker"));
    };
    document.head.appendChild(s);
  });
  return pickerReady;
}

export interface PickedSheet {
  id: string;
  name: string;
}

/** Mở hộp chọn Sheet. Trả null nếu người dùng đóng hộp mà không chọn. Ném lỗi (tiếng Việt) nếu không lấy được quyền Google. */
export async function pickSpreadsheet(apiKey: string, appId: string): Promise<PickedSheet | null> {
  const tokenRes = await fetch("/api/google/token", { cache: "no-store" });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) throw new Error(tokenJson.error ?? "Không lấy được quyền Google");
  await loadPicker();
  const g = window.google.picker;
  return new Promise<PickedSheet | null>((resolve) => {
    const view = new g.DocsView(g.ViewId.SPREADSHEETS).setMode(g.DocsViewMode.LIST);
    new g.PickerBuilder()
      .addView(view)
      .setOAuthToken(tokenJson.accessToken)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setCallback((data: any) => {
        if (data.action === g.Action.CANCEL) return resolve(null);
        if (data.action !== g.Action.PICKED) return;
        const doc = data.docs[0] as { id: string; name: string };
        resolve({ id: doc.id, name: doc.name });
      })
      .build()
      .setVisible(true);
  });
}

/** Danh sách tab của một Sheet đã chọn. */
export async function listSheetTabs(spreadsheetId: string): Promise<string[]> {
  const r = await fetch(`/api/google/tabs?spreadsheetId=${encodeURIComponent(spreadsheetId)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Không đọc được file.");
  return j.tabs as string[];
}
