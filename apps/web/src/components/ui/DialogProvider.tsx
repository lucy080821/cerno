"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import s from "./dialog.module.css";

/**
 * Hộp thoại xác nhận / nhập liệu / thông báo của ứng dụng. QUY ĐỊNH: không bao giờ dùng window.alert / confirm /
 * prompt của trình duyệt (xấu, không đổi giao diện được, chặn luồng). Mọi chỗ cần hỏi người dùng đều gọi
 * \`useDialog()\`; có test (dialog-rule.test.ts) chặn việc dùng lại hàm của trình duyệt.
 */

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** "danger": nút xác nhận màu đỏ và nút Hủy được chọn sẵn (tránh Enter lỡ tay xóa nhầm). */
  tone?: "default" | "danger";
}

export interface PromptOptions {
  title?: string;
  message?: ReactNode;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  maxLength?: number;
  /** Trả về chuỗi lỗi để chặn xác nhận, hoặc null nếu hợp lệ. */
  validate?: (value: string) => string | null;
}

export interface AlertOptions {
  title?: string;
  message: ReactNode;
  okText?: string;
  tone?: "default" | "danger";
}

export interface DialogApi {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  prompt: (o: PromptOptions) => Promise<string | null>;
  alert: (o: AlertOptions) => Promise<void>;
}

type Item =
  | { kind: "confirm"; o: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; o: PromptOptions; resolve: (v: string | null) => void }
  | { kind: "alert"; o: AlertOptions; resolve: () => void };

/** Khi chưa có Provider (ví dụ test): không hiện gì và coi như người dùng hủy, tuyệt đối không rơi về hộp thoại trình duyệt. */
const FALLBACK: DialogApi = {
  confirm: async () => false,
  prompt: async () => null,
  alert: async () => undefined,
};

const Ctx = createContext<DialogApi>(FALLBACK);

export const useDialog = (): DialogApi => useContext(Ctx);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Item | null>(null);
  const queue = useRef<Item[]>([]);

  const next = useCallback(() => {
    setCurrent(queue.current.shift() ?? null);
  }, []);

  const push = useCallback((item: Item) => {
    setCurrent((cur) => {
      if (cur) {
        queue.current.push(item); // đang có hộp thoại: xếp hàng, hiện lần lượt
        return cur;
      }
      return item;
    });
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (o) => new Promise<boolean>((resolve) => push({ kind: "confirm", o, resolve })),
      prompt: (o) => new Promise<string | null>((resolve) => push({ kind: "prompt", o, resolve })),
      alert: (o) => new Promise<void>((resolve) => push({ kind: "alert", o, resolve })),
    }),
    [push],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {current && typeof document !== "undefined"
        ? createPortal(<Modal item={current} onDone={next} />, document.body)
        : null}
    </Ctx.Provider>
  );
}

function Modal({ item, onDone }: { item: Item; onDone: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(item.kind === "prompt" ? item.o.defaultValue ?? "" : "");
  const [error, setError] = useState("");

  const danger = item.kind !== "prompt" && item.o.tone === "danger";

  const finish = useCallback(
    (ok: boolean) => {
      if (item.kind === "confirm") item.resolve(ok);
      else if (item.kind === "alert") item.resolve();
      else if (ok) {
        const msg = item.o.validate?.(value) ?? null;
        if (msg) {
          setError(msg);
          return;
        }
        item.resolve(value);
      } else item.resolve(null);
      onDone();
    },
    [item, value, onDone],
  );

  // Chọn sẵn đúng nút: ô nhập (prompt), nút Hủy (xóa/nguy hiểm), nút chính (còn lại).
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    if (item.kind === "prompt") {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (danger) cancelRef.current?.focus();
    else okRef.current?.focus();
    return () => prev?.focus?.();
    // chỉ chạy khi hộp thoại mở
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phím: Esc = hủy; Tab xoay vòng trong hộp; các phím tắt khác của editor bị chặn khi hộp đang mở.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
        return;
      }
      if (e.key === "Tab") {
        const nodes = boxRef.current?.querySelectorAll<HTMLElement>("button, input");
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
      if (!typing && e.key !== "Enter") e.stopPropagation(); // không để Delete, Ctrl+Z... lọt xuống editor phía sau
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [finish]);

  const title =
    item.o.title ?? (item.kind === "confirm" ? "Xác nhận" : item.kind === "prompt" ? "Nhập thông tin" : "Thông báo");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    finish(true);
  };

  return (
    <div
      className={s.back}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && item.kind !== "alert") finish(false);
      }}
    >
      <div
        ref={boxRef}
        className={`${s.box} ${danger ? s.danger : ""}`}
        role={danger || item.kind === "alert" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="dlg-title"
        aria-describedby="dlg-msg"
      >
        <form onSubmit={submit}>
          <div className={s.head}>
            <span className={s.badge} aria-hidden>{danger ? "!" : item.kind === "prompt" ? "✎" : item.kind === "alert" ? "i" : "?"}</span>
            <h2 id="dlg-title" className={s.title}>{title}</h2>
          </div>

          {item.kind === "prompt" ? (
            item.o.message ? <div id="dlg-msg" className={s.msg}>{item.o.message}</div> : <span id="dlg-msg" />
          ) : (
            <div id="dlg-msg" className={s.msg}>{item.o.message}</div>
          )}

          {item.kind === "prompt" && (
            <label className={s.field}>
              {item.o.label && <span>{item.o.label}</span>}
              <input
                ref={inputRef}
                className={s.input}
                value={value}
                maxLength={item.o.maxLength}
                placeholder={item.o.placeholder}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError("");
                }}
                autoComplete="off"
                spellCheck={false}
              />
              {error && <em className={s.error} role="alert">{error}</em>}
            </label>
          )}

          <div className={s.actions}>
            {item.kind !== "alert" && (
              <button ref={cancelRef} type="button" className={s.ghost} onClick={() => finish(false)}>
                {item.o.cancelText ?? "Hủy"}
              </button>
            )}
            <button ref={okRef} type="submit" className={danger ? s.dangerBtn : s.primary}>
              {item.kind === "alert" ? item.o.okText ?? "Đã hiểu" : item.o.confirmText ?? (danger ? "Xóa" : "Đồng ý")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
