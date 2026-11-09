"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./dashboards.module.css";
import { Spinner } from "@/components/Spinner";

/* eslint-disable @typescript-eslint/no-explicit-any */
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
    s.onerror = () => reject(new Error("Không tải được Google Picker"));
    document.head.appendChild(s);
  });
  return pickerReady;
}

interface Picked {
  id: string;
  name: string;
}

export function ConnectSheet({ apiKey, appId }: { apiKey: string; appId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [tab, setTab] = useState("");

  const notConfigured = !apiKey || !appId;

  async function importTab(file: Picked, sheetName: string) {
    setBusy(true);
    setMsg("Đang đọc dữ liệu…");
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spreadsheetId: file.id, sheetName, name: `${file.name} › ${sheetName}` }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(json.error ?? "Không thêm được nguồn.");
    setPicked(null);
    setTabs([]);
    setMsg(`Đã thêm ${json.rowCount} dòng.`);
    router.refresh();
  }

  async function choose() {
    setMsg("");
    setBusy(true);
    try {
      const tokenRes = await fetch("/api/google/token", { cache: "no-store" });
      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenJson.error ?? "Không lấy được quyền Google");
      await loadPicker();

      const g = window.google.picker;
      const view = new g.DocsView(g.ViewId.SPREADSHEETS).setMode(g.DocsViewMode.LIST);
      const picker = new g.PickerBuilder()
        .addView(view)
        .setOAuthToken(tokenJson.accessToken)
        .setDeveloperKey(apiKey)
        .setAppId(appId)
        .setCallback(async (data: any) => {
          if (data.action === g.Action.CANCEL) return setBusy(false);
          if (data.action !== g.Action.PICKED) return;
          const doc = data.docs[0] as { id: string; name: string };
          setPicked({ id: doc.id, name: doc.name });
          setMsg("Đang lấy danh sách tab…");
          const r = await fetch(`/api/google/tabs?spreadsheetId=${encodeURIComponent(doc.id)}`);
          const j = await r.json().catch(() => ({}));
          if (!r.ok) {
            setBusy(false);
            return setMsg(j.error ?? "Không đọc được file.");
          }
          if (j.tabs.length === 1) return importTab({ id: doc.id, name: doc.name }, j.tabs[0]);
          setTabs(j.tabs);
          setTab(j.tabs[0]);
          setBusy(false);
          setMsg("");
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      setBusy(false);
      setMsg(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }

  return (
    <div className={styles.connect}>
      <button className={styles.primary} onClick={choose} disabled={busy || notConfigured}>
        + Chọn Google Sheet
      </button>
      {notConfigured && (
        <p className={styles.warn}>Thiếu NEXT_PUBLIC_GOOGLE_API_KEY / NEXT_PUBLIC_GOOGLE_APP_ID.</p>
      )}
      {picked && tabs.length > 1 && (
        <div className={styles.tabPick}>
          <label>
            Tab của “{picked.name}”
            <select value={tab} onChange={(e) => setTab(e.target.value)}>
              {tabs.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <button className={styles.primary} disabled={busy} onClick={() => importTab(picked, tab)}>
            Thêm
          </button>
        </div>
      )}
      {msg && <p className={styles.msg} role="status">{busy && <Spinner size={12} inline />}{msg}</p>}
    </div>
  );
}
