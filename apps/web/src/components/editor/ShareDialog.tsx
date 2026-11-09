"use client";

import { useEffect, useMemo, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { parseDomains } from "@/lib/embed/domains";
import { normalizeEmail } from "@/lib/embed/email";
import {
  disableLink, disableShare, enableLink, enableShare, getLink, getShare, iframeCode, invitePerson, changeRole, invitedUrl,
  listPeople, removePerson, rotateLink, rotateShare, saveShareDomains, shareUrl, viewUrl,
  type AccessRole, type MailStatus, type LinkState, type Person, type ShareState,
} from "@/lib/embed/api";
import { Spinner } from "@/components/Spinner";
import { useDialog } from "@/components/ui/DialogProvider";

import { Icon } from "./fields";
import s from "./editor.module.css";

function CopyBox({ label, value, rows = 1 }: { label: string; value: string; rows?: number }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      window.setTimeout(() => setDone(false), 1800);
    } catch {
      /* trình duyệt chặn clipboard: người dùng vẫn chọn và copy tay được */
    }
  };
  return (
    <div className={s.shareBox}>
      <span className={s.label}>{label}</span>
      <div className={s.shareRow}>
        <textarea className={`${s.input} ${s.shareCode}`} readOnly rows={rows} value={value}
          onFocus={(e) => e.currentTarget.select()} />
        <button className={s.btn} onClick={copy}>{done ? "Đã chép" : "Chép"}</button>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className={s.shareLoading}>
      <Spinner size={26} label="Đang tải…" />
    </div>
  );
}

const ROLE_LABEL: Record<AccessRole, string> = { viewer: "Chỉ xem", editor: "Được sửa" };

/** Lý do không gửi được email: quyền vẫn đã được cấp, chủ gửi link thủ công. */
const MAIL_FAIL: Record<NonNullable<MailStatus["reason"]>, string> = {
  not_configured: "Đã cấp quyền nhưng chưa cấu hình gửi email trên máy chủ. Hãy gửi link bên dưới cho họ.",
  rate_limited: "Đã cấp quyền nhưng gửi email quá nhiều trong một giờ, thử gửi lại sau. Hoặc gửi link bên dưới cho họ.",
  send_failed: "Đã cấp quyền nhưng chưa gửi được email. Bấm \"Gửi lại\" hoặc gửi link bên dưới cho họ.",
};

/** Hook nhỏ: chạy một thao tác bất đồng bộ, theo dõi trạng thái bận và lỗi. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async <T,>(fn: () => Promise<T>, after?: (r: T) => void) => {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      after?.(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

// ---------------------------------------------------------------------------------------------
// Tab 1: Link xem + mời người (xem trên Cerno)

function LinkTab({ dashboardId }: { dashboardId: string }) {
  const dialog = useDialog();
  const [link, setLink] = useState<LinkState | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccessRole>("viewer");
  /** Kết quả lần gửi email gần nhất: { to, ok, reason } để báo ngay dưới ô mời. */
  const [mailNote, setMailNote] = useState<{ to: string; mail: MailStatus } | null>(null);
  const a = useAction();
  const invite = (to: string, r: AccessRole) =>
    a.run(() => invitePerson(dashboardId, to, r), (res) => {
      setPeople(res.people);
      setMailNote(res.mail ? { to, mail: res.mail } : null);
    });

  useEffect(() => {
    let off = false;
    Promise.all([getLink(dashboardId), listPeople(dashboardId)])
      .then(([l, p]) => { if (!off) { setLink(l); setPeople(p); } })
      .catch((e: Error) => { if (!off) a.setError(e.message); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId]);

  const origin = window.location.origin;
  const normalized = normalizeEmail(email);

  if (!link || !people) return a.error ? <p className={s.calcError} role="alert">{a.error}</p> : <Loading />;

  return (
    <>
      <div className={s.shareBox}>
        <span className={s.label}>Link xem</span>
        <p className={s.hint}>
          Ai có link đều xem được dashboard ngay trên Cerno, <b>không cần đăng nhập</b>. Họ đổi được bộ lọc nhưng
          không sửa được gì.
        </p>
        {!link.enabled ? (
          <>
            <p className={s.calcWarn}>Ai có link đều xem được toàn bộ dữ liệu của dashboard (cả các trang). Chỉ bật khi dữ liệu được phép công khai.</p>
            <div><button className={`${s.btn} ${s.btnActive}`} disabled={a.busy}
              onClick={() => a.run(() => enableLink(dashboardId), setLink)}>Bật link xem</button></div>
          </>
        ) : (
          <>
            <CopyBox label="Gửi link này cho người xem" value={link.token ? viewUrl(origin, link.token) : ""} />
            <div className={s.shareRow}>
              <button className={s.btn} disabled={a.busy}
                onClick={async () => {
                  const ok = await dialog.confirm({ title: "Tạo link mới?", message: "Link cũ sẽ ngừng hoạt động ngay.", confirmText: "Tạo link mới", tone: "danger" });
                  if (ok) void a.run(() => rotateLink(dashboardId), setLink);
                }}>
                Tạo link mới
              </button>
              <button className={`${s.smallBtn} ${s.danger}`} disabled={a.busy}
                onClick={async () => {
                  const ok = await dialog.confirm({ title: "Tắt link xem?", message: "Những người đang giữ link sẽ không xem được nữa.", confirmText: "Tắt link", tone: "danger" });
                  if (ok) void a.run(() => disableLink(dashboardId), setLink);
                }}>
                Tắt link xem
              </button>
            </div>
          </>
        )}
      </div>

      <div className={s.shareBox}>
        <span className={s.label}>Mời người cụ thể (cần đăng nhập Google)</span>
        <p className={s.hint}>
          Nhập email Google của họ. <b>Chỉ xem</b>: xem và lọc. <b>Được sửa</b>: chỉnh sửa dashboard này (không thấy dashboard
          hay nguồn dữ liệu khác của bạn, không chia sẻ tiếp được). Cerno sẽ gửi email mời kèm link tới họ; nếu email không tới, hãy gửi link bên dưới.
        </p>
        <form className={s.shareRow} onSubmit={(e) => {
          e.preventDefault();
          if (!normalized) return;
          void invite(normalized, role);
          setEmail("");
        }}>
          <input className={s.input} style={{ flex: 1, minWidth: 180 }} type="email" value={email} placeholder="ten@gmail.com"
            onChange={(e) => setEmail(e.target.value)} aria-label="Email người được mời" />
          <select className={s.input} style={{ width: "auto" }} value={role} onChange={(e) => setRole(e.target.value as AccessRole)}>
            <option value="viewer">Chỉ xem</option>
            <option value="editor">Được sửa</option>
          </select>
          <button className={`${s.btn} ${s.btnActive}`} type="submit" disabled={a.busy || !normalized}>Mời</button>
        </form>
        {email.trim() && !normalized && <p className={s.calcError}>Email chưa đúng dạng.</p>}
        {mailNote && (
          mailNote.mail.sent
            ? <p className={s.calcOk}>Đã gửi email mời tới {mailNote.to}.</p>
            : <p className={s.calcWarn}>{MAIL_FAIL[mailNote.mail.reason ?? "send_failed"]}</p>
        )}

        {people.length === 0 ? (
          <p className={s.hint}>Chưa mời ai.</p>
        ) : (
          <ul className={s.peopleList}>
            {people.map((p) => (
              <li key={p.email} className={s.personRow}>
                <span className={s.personEmail} title={p.email}>{p.email}</span>
                <select className={s.input} style={{ width: "auto" }} value={p.role} disabled={a.busy}
                  aria-label={`Quyền của ${p.email}`}
                  onChange={(e) => void a.run(() => changeRole(dashboardId, p.email, e.target.value as AccessRole), setPeople)}>
                  {(Object.keys(ROLE_LABEL) as AccessRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                <button className={s.smallBtn} title="Gửi lại email mời" disabled={a.busy}
                  onClick={() => void invite(p.email, p.role)}>
                  Gửi lại
                </button>
                <button className={s.iconBtn} title="Thu hồi quyền" disabled={a.busy}
                  onClick={async () => {
                    const ok = await dialog.confirm({ title: "Thu hồi quyền?", message: `Thu hồi quyền truy cập của ${p.email}?`, confirmText: "Thu hồi", tone: "danger" });
                    if (ok) void a.run(() => removePerson(dashboardId, p.email), setPeople);
                  }}>
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {people.some((p) => p.role === "viewer") && (
          <CopyBox label="Link cho người được mời Chỉ xem" value={invitedUrl(origin, dashboardId, "viewer")} />
        )}
        {people.some((p) => p.role === "editor") && (
          <CopyBox label="Link cho người được mời Sửa" value={invitedUrl(origin, dashboardId, "editor")} />
        )}
        {people.length > 0 && (
          <p className={s.hint}>Họ phải đăng nhập Google bằng đúng email đã mời. Mở link khi chưa đăng nhập sẽ được chuyển tới trang đăng nhập rồi quay lại.</p>
        )}
      </div>
      {a.busy && <p className={s.calcOk}><Spinner size={12} inline />Đang xử lý…</p>}
      {a.error && <p className={s.calcError} role="alert">{a.error}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Tab 2: Nhúng vào website (iframe, giới hạn tên miền)

/** Ba bước làm theo thứ tự; bước đã xong có dấu tích để người dùng biết đang ở đâu. */
function EmbedSteps({ enabled, hasDomains }: { enabled: boolean; hasDomains: boolean }) {
  const steps = [
    { done: enabled, title: "Bật nhúng", text: "Tạo đường dẫn nhúng riêng cho dashboard này." },
    {
      done: enabled && hasDomains,
      title: "Khai báo website được phép nhúng",
      text: "Nhập tên miền, mỗi dòng một tên (ví dụ congty.com). Website khác không nhúng được dù có đoạn mã.",
    },
    {
      done: false,
      title: "Dán đoạn mã vào trang web",
      text: "Sao chép đoạn mã <iframe> rồi dán vào nơi muốn hiển thị dashboard trong mã HTML của trang.",
    },
  ];
  return (
    <ol className={s.steps} aria-label="Các bước nhúng">
      {steps.map((st, i) => (
        <li key={st.title} className={`${s.step} ${st.done ? s.stepDone : ""}`}>
          <span className={s.stepNum} aria-hidden>{st.done ? "✓" : i + 1}</span>
          <div>
            <div className={s.stepTitle}>{st.title}</div>
            <p className={s.stepText}>{st.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Hướng dẫn dán mã trên các nền tảng phổ biến và cách xử lý khi không hiện. */
function EmbedHelp() {
  return (
    <>
      <details className={s.guideBox}>
        <summary>Dán đoạn mã ở đâu?</summary>
        <div className={s.guideBody}>
          <ul>
            <li><b>Website tự viết (HTML):</b> dán đoạn mã vào đúng vị trí muốn hiện, bên trong thẻ <code>&lt;body&gt;</code>.</li>
            <li><b>WordPress:</b> thêm khối &quot;HTML tùy chỉnh&quot; (Custom HTML) vào bài viết hoặc trang, rồi dán đoạn mã.</li>
            <li><b>Wix:</b> Thêm (Add) → Nhúng mã (Embed Code) → Nhúng HTML, chọn &quot;Mã&quot; và dán đoạn mã.</li>
            <li><b>Google Sites:</b> Chèn → Nhúng → tab &quot;Mã nhúng&quot;, dán đoạn mã.</li>
            <li><b>Notion, Slack, email:</b> các nơi này không cho khai báo tên miền của bạn, hãy dùng link ở tab &quot;Link và mời người&quot;.</li>
          </ul>
          <span>Muốn đổi kích thước, sửa <code>width</code> và <code>height</code> trong đoạn mã (mặc định rộng 100%, cao 700px).</span>
        </div>
      </details>

      <details className={s.guideBox}>
        <summary>Không hiển thị hoặc bị chặn?</summary>
        <div className={s.guideBody}>
          <ul>
            <li>Website phải chạy bằng <b>https</b>. Trang <code>http://</code> không nhúng được.</li>
            <li>Tên miền phải khớp: <code>congty.com</code> đã gồm <code>www.congty.com</code>; tên miền con như <code>app.congty.com</code> cần thêm <code>*.congty.com</code>.</li>
            <li>Vừa sửa tên miền thì bấm &quot;Lưu tên miền&quot; rồi tải lại trang web (có thể mất vài giây).</li>
            <li>Đã tạo mã nhúng mới thì đoạn mã cũ ngừng hoạt động: dán lại đoạn mã mới.</li>
            <li>Dashboard dùng nguồn Google Sheets thì dữ liệu cập nhật theo chu kỳ đồng bộ của Cerno, không theo từng lần mở trang.</li>
          </ul>
        </div>
      </details>
    </>
  );
}

function EmbedTab({ dashboardId }: { dashboardId: string }) {
  const dialog = useDialog();
  const name = useEditor((st) => st.doc.name);
  const [state, setState] = useState<ShareState | null>(null);
  const [domainText, setDomainText] = useState("");
  const [saved, setSaved] = useState(false);
  const a = useAction();

  useEffect(() => {
    let off = false;
    getShare(dashboardId)
      .then((r) => { if (!off) { setState(r); setDomainText(r.domains.join("\n")); } })
      .catch((e: Error) => { if (!off) a.setError(e.message); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId]);

  const parsed = useMemo(() => parseDomains(domainText), [domainText]);
  const dirty = state ? parsed.domains.join("\n") !== state.domains.join("\n") : false;
  const url = state?.token ? shareUrl(window.location.origin, state.token) : "";

  if (!state) return a.error ? <p className={s.calcError} role="alert">{a.error}</p> : <Loading />;

  return (
    <>
      <EmbedSteps enabled={state.enabled} hasDomains={state.domains.length > 0} />

      {!state.enabled ? (
        <div className={s.shareCard}>
          <p>
            Nhúng dashboard vào website của công ty bằng <code>&lt;iframe&gt;</code>. Chỉ các tên miền bạn khai báo mới
            nhúng được. Người xem không cần đăng nhập, chỉ xem và đổi bộ lọc.
          </p>
          <div className={s.shareNote} role="note">
            <span aria-hidden>⚠</span>
            <span>Ai có đường dẫn nhúng đều xem được toàn bộ dữ liệu của dashboard (giới hạn tên miền chỉ chặn website khác nhúng). Chỉ bật khi dữ liệu được phép công khai.</span>
          </div>
          <div><button className={`${s.btn} ${s.btnActive}`} disabled={a.busy}
            onClick={() => a.run(() => enableShare(dashboardId), (r) => { setState(r); setDomainText(r.domains.join("\n")); })}>
            {a.busy ? <><Spinner size={12} inline />Đang bật…</> : "Bật nhúng"}
          </button></div>
        </div>
      ) : (
        <>
          <div className={s.shareCard}>
            <span className={s.label}>1. Tên miền được phép nhúng</span>
            <p className={s.hint}>
              Mỗi dòng một tên miền. <code>congty.com</code> cho cả <code>www.congty.com</code>;
              {" "}<code>*.congty.com</code> cho mọi tên miền con. Để trống = chưa website nào nhúng được.
            </p>
            <textarea className={`${s.input} ${s.shareCode}`} rows={4} value={domainText} spellCheck={false}
              placeholder={"congty.com\n*.congty.vn"}
              onChange={(e) => { setDomainText(e.target.value); setSaved(false); }} />
            {parsed.invalid.length > 0 && (
              <p className={s.calcError} role="alert">Không hợp lệ: {parsed.invalid.slice(0, 3).join(", ")}. Chỉ nhập tên miền, ví dụ congty.com.</p>
            )}
            {parsed.tooMany && <p className={s.calcError}>Tối đa 20 tên miền.</p>}
            <div className={s.shareRow}>
              <button className={`${s.btn} ${s.btnActive}`}
                disabled={a.busy || parsed.invalid.length > 0 || parsed.tooMany || !dirty}
                onClick={() => a.run(() => saveShareDomains(dashboardId, parsed.domains), (r) => { setState(r); setDomainText(r.domains.join("\n")); setSaved(true); })}>
                Lưu tên miền
              </button>
              {saved && !dirty && <span className={s.calcOk}>Đã lưu</span>}
              {state.domains.length === 0 && <span className={s.calcWarn}>Chưa có tên miền nào, nên chưa nhúng được.</span>}
            </div>
          </div>

          <CopyBox label="2. Đoạn mã dán vào website" rows={3} value={iframeCode(url, name)} />

          <EmbedHelp />

          <p className={s.hint}>
            Giới hạn tên miền chỉ <b>chặn website khác nhúng</b>, không che được đường dẫn: ai có đường dẫn nhúng vẫn mở
            trực tiếp được. Bị lộ thì bấm &quot;Tạo mã nhúng mới&quot; (mã cũ ngừng ngay) hoặc tắt nhúng.
          </p>

          <div className={s.shareRow}>
            <button className={s.btn} disabled={a.busy}
              onClick={async () => {
                const ok = await dialog.confirm({ title: "Tạo mã nhúng mới?", message: "Đoạn mã cũ trên website sẽ ngừng hoạt động, bạn phải cập nhật lại bằng đoạn mã mới.", confirmText: "Tạo mã mới", tone: "danger" });
                if (ok) void a.run(() => rotateShare(dashboardId), setState);
              }}>
              Tạo mã nhúng mới
            </button>
            <button className={`${s.smallBtn} ${s.danger}`} disabled={a.busy}
              onClick={async () => {
                const ok = await dialog.confirm({ title: "Tắt nhúng?", message: "Các website đã nhúng sẽ không xem được dashboard nữa.", confirmText: "Tắt nhúng", tone: "danger" });
                if (ok) void a.run(() => disableShare(dashboardId), setState);
              }}>
              Tắt nhúng
            </button>
          </div>
        </>
      )}
      {a.busy && <p className={s.calcOk}><Spinner size={12} inline />Đang xử lý…</p>}
      {a.error && <p className={s.calcError} role="alert">{a.error}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

/** Chia sẻ dashboard: (1) link xem + mời người trên Cerno, (2) nhúng vào website khác. Chỉ chủ dashboard mở được. */
export function ShareDialog({ dashboardId, onClose }: { dashboardId: string; onClose: () => void }) {
  const [tab, setTab] = useState<"link" | "embed">("link");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={s.modalBack} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${s.dialog} ${s.dialogShare}`} role="dialog" aria-modal="true" aria-label="Chia sẻ dashboard">
        <div className={s.shareHead}>
          <div className={s.shareHeadRow}>
            <strong>Chia sẻ dashboard</strong>
            <button className={s.iconBtn} title="Đóng (Esc)" onClick={onClose}><Icon name="close" size={14} /></button>
          </div>
          <span className={s.shareSub}>Chọn cách đưa dashboard tới người xem. Bạn có thể tắt hoặc đổi link bất cứ lúc nào.</span>
        </div>
        <div className={s.shareTabs} role="tablist">
          <button role="tab" aria-selected={tab === "link"} className={`${s.shareTab} ${tab === "link" ? s.shareTabOn : ""}`} onClick={() => setTab("link")}>
            Link và mời người
          </button>
          <button role="tab" aria-selected={tab === "embed"} className={`${s.shareTab} ${tab === "embed" ? s.shareTabOn : ""}`} onClick={() => setTab("embed")}>
            Nhúng vào website
          </button>
        </div>

        <div className={s.shareBody}>
          {tab === "link" ? <LinkTab dashboardId={dashboardId} /> : <EmbedTab dashboardId={dashboardId} />}
        </div>

        <div className={s.shareFoot}>
          <button className={s.btn} onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
