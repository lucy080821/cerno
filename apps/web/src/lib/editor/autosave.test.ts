import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dashboard } from "@dashboard/schema";
import { createDemoDashboard } from "./defaults";
import { createAutosaver, type SaveResult, type SaveStatus } from "./autosave";

const flushMicro = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(save: (doc: Dashboard, rev: string) => Promise<SaveResult>) {
  let doc = createDemoDashboard();
  const log: SaveStatus[] = [];
  const saver = createAutosaver({
    save, rev: "r0", getDoc: () => doc, onStatus: (s) => log.push(s), delay: 1000, retryDelay: 5000,
  });
  const edit = () => {
    doc = { ...doc, name: doc.name + "!" };
    saver.notify();
  };
  return { saver, edit, log };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createAutosaver", () => {
  it("gom nhiều lần sửa thành một lần lưu, đúng phiên bản", async () => {
    const save = vi.fn(async (_d: Dashboard, _rev: string): Promise<SaveResult> => ({ ok: true, rev: "r1" }));
    const { edit, saver, log } = setup(save);
    edit(); edit(); edit();
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toBe("r0");
    expect(saver.getStatus()).toBe("saved");
    expect(log).toEqual(["dirty", "dirty", "dirty", "saving", "saved"]);
  });

  it("lần lưu sau dùng phiên bản mới trả về từ lần trước", async () => {
    let n = 0;
    const save = vi.fn(async (): Promise<SaveResult> => ({ ok: true, rev: `r${++n}` }));
    const { edit } = setup(save);
    edit();
    await vi.advanceTimersByTimeAsync(1100);
    edit();
    await vi.advanceTimersByTimeAsync(1100);
    expect(save.mock.calls.map((c) => (c as unknown[])[1])).toEqual(["r0", "r1"]);
  });

  it("sửa trong lúc đang lưu thì lưu tiếp, không chạy song song", async () => {
    let release!: (r: SaveResult) => void;
    const save = vi.fn(() => new Promise<SaveResult>((res) => (release = res)));
    const { edit, saver } = setup(save);
    edit();
    await vi.advanceTimersByTimeAsync(1100);
    expect(saver.getStatus()).toBe("saving");
    edit(); // sửa khi đang lưu
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1); // vẫn chưa gọi lần hai
    release({ ok: true, rev: "r1" });
    await flushMicro();
    expect(saver.getStatus()).toBe("dirty");
    save.mockImplementation(async () => ({ ok: true, rev: "r2" }));
    await vi.advanceTimersByTimeAsync(1100);
    expect(save).toHaveBeenCalledTimes(2);
    expect(saver.getStatus()).toBe("saved");
  });

  it("lỗi thì báo lỗi và tự thử lại", async () => {
    const save = vi
      .fn<(d: Dashboard, r: string) => Promise<SaveResult>>()
      .mockResolvedValueOnce({ ok: false, kind: "error", message: "mất mạng" })
      .mockResolvedValueOnce({ ok: true, rev: "r1" });
    const { edit, saver } = setup(save);
    edit();
    await vi.advanceTimersByTimeAsync(1100);
    expect(saver.getStatus()).toBe("error");
    await vi.advanceTimersByTimeAsync(5100);
    expect(save).toHaveBeenCalledTimes(2);
    expect(saver.getStatus()).toBe("saved");
  });

  it("xung đột thì dừng hẳn cho tới khi người dùng chọn", async () => {
    const save = vi
      .fn<(d: Dashboard, r: string) => Promise<SaveResult>>()
      .mockResolvedValueOnce({ ok: false, kind: "conflict" })
      .mockResolvedValue({ ok: true, rev: "r9" });
    const { edit, saver } = setup(save);
    edit();
    await vi.advanceTimersByTimeAsync(1100);
    expect(saver.getStatus()).toBe("conflict");
    edit();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1); // không tự ghi đè

    await saver.resolveOverwrite("r5");
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toBe("r5");
    expect(saver.getStatus()).toBe("saved");
  });

  it("reset (tải bản mới) huỷ thay đổi đang chờ lưu", async () => {
    const save = vi.fn(async (): Promise<SaveResult> => ({ ok: true, rev: "r1" }));
    const { edit, saver } = setup(save);
    edit();
    saver.reset("r7");
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    expect(saver.getStatus()).toBe("saved");
  });

  it("dispose thì không lưu nữa", async () => {
    const save = vi.fn(async (): Promise<SaveResult> => ({ ok: true, rev: "r1" }));
    const { edit, saver } = setup(save);
    edit();
    saver.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });
});
