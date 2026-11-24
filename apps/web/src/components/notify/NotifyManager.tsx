"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Dashboard } from "@dashboard/schema";
import { Card } from "@/components/profit/Shared";
import { Spinner } from "@/components/Spinner";
import { AlertsTab } from "@/components/editor/AlertsTab";
import { ReportsTab } from "@/components/editor/NotifyDialog";
import { reportableWidgets, type ReportableWidget } from "@/lib/notify/format";
import { pickDashboard, type DashOption } from "@/lib/notify/pick";
import { createClient } from "@/lib/supabase/client";
import profit from "@/components/profit/profit.module.css";
import editor from "@/components/editor/editor.module.css";
import styles from "./notify-manager.module.css";

const KEY = "cerno.notify.dashboard";

/**
 * Cài đặt cảnh báo / báo cáo định kỳ ngay tại trang riêng (không cần mở editor): chọn một dashboard rồi tạo, sửa, bật/tắt,
 * thử gửi ngay bên dưới. Dùng lại đúng hai tab của hộp thoại Thông báo (cùng API, cùng giới hạn gói, cùng kiểm quyền bằng RLS).
 */
export function NotifyManager({ kind, dashboards, initialId }: { kind: "alerts" | "reports"; dashboards: DashOption[]; initialId?: string | null }) {
  const [selected, setSelected] = useState<string | null>(() => pickDashboard(dashboards, initialId, null));
  const [widgets, setWidgets] = useState<ReportableWidget[] | null>(null);
  const [error, setError] = useState("");

  // Lần mở sau nhớ dashboard đã chọn (đọc sau khi trang hiện để server và trình duyệt vẽ khớp nhau).
  useEffect(() => {
    if (selected) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      /* localStorage bị chặn */
    }
    const pick = pickDashboard(dashboards, initialId, saved);
    if (pick) setSelected(pick);
  }, [selected, dashboards, initialId]);

  useEffect(() => {
    if (!selected) return;
    try {
      localStorage.setItem(KEY, selected);
    } catch {
      /* localStorage bị chặn */
    }
  }, [selected]);

  // Báo cáo cần danh sách widget để chọn ảnh đưa vào email; cảnh báo thì không cần doc.
  useEffect(() => {
    if (!selected || kind !== "reports") return;
    let alive = true;
    setWidgets(null);
    setError("");
    void createClient()
      .from("dashboards")
      .select("doc")
      .eq("id", selected)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (!alive) return;
        const parsed = data ? Dashboard.safeParse(data.doc) : null;
        if (err || !parsed?.success) {
          setError("Không đọc được dashboard này, hãy thử lại.");
          return;
        }
        setWidgets(reportableWidgets(parsed.data));
      });
    return () => {
      alive = false;
    };
  }, [selected, kind]);

  const current = useMemo(() => dashboards.find((d) => d.id === selected) ?? null, [dashboards, selected]);

  if (dashboards.length === 0) {
    return (
      <Card title={kind === "alerts" ? "Tạo cảnh báo mới" : "Đặt lịch báo cáo mới"}>
        <p className={profit.small}>Bạn chưa có dashboard nào. <Link href="/templates">Tạo dashboard từ mẫu</Link> trước, rồi quay lại đây để cài đặt.</p>
      </Card>
    );
  }

  return (
    <div id="manage" className={profit.stack}>
      <Card title="Chọn dashboard" aside={kind === "alerts" ? "dashboard chứa số liệu cần theo dõi" : "dashboard muốn gửi báo cáo"}>
        <div className={styles.chips} role="radiogroup" aria-label="Dashboard">
          {dashboards.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={d.id === selected} className={`${styles.chip} ${d.id === selected ? styles.chipOn : ""}`} onClick={() => setSelected(d.id)} data-i18n-skip>
              {d.name}
            </button>
          ))}
        </div>
      </Card>
      {!current ? (
        <Card title={kind === "alerts" ? "Cảnh báo" : "Báo cáo định kỳ"}>
          <p className={profit.small}>{kind === "alerts" ? "Chọn một dashboard ở trên để xem, tạo và chỉnh cảnh báo." : "Chọn một dashboard ở trên để xem, đặt lịch và chỉnh báo cáo."}</p>
        </Card>
      ) : (
        <Card title={kind === "alerts" ? "Cảnh báo của dashboard" : "Báo cáo của dashboard"} aside={current.name}>
          <div className={editor.scope}>
            {kind === "alerts" ? (
              <AlertsTab key={current.id} dashboardId={current.id} />
            ) : error ? (
              <p className={profit.small}>{error}</p>
            ) : widgets === null ? (
              <div className={styles.loading}><Spinner size={26} label="Đang tải…" /></div>
            ) : (
              <ReportsTab key={current.id} dashboardId={current.id} widgets={widgets} />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
