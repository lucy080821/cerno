import { describe, expect, it } from "vitest";
import { hostImages, purgeOldReportImages, useHostedUrls, type StorageLike } from "./hosted-images";

const png = (cid: string) => ({ cid, content: Buffer.from([1, 2, 3]), contentType: "image/png" });

function fake(opts: { failAt?: number; files?: string[]; httpUrl?: boolean } = {}) {
  const files = new Set<string>(opts.files ?? []);
  let n = 0;
  const client: StorageLike = {
    storage: {
      from: () => ({
        upload: async (path) => {
          if (opts.failAt === n++) return { error: new Error("không có bucket") };
          files.add(path);
          return { error: null };
        },
        getPublicUrl: (p) => ({ data: { publicUrl: `${opts.httpUrl ? "http" : "https"}://x.supabase.co/storage/v1/object/public/report-images/${p}` } }),
        list: async () => ({ data: [...files].map((name) => ({ name })), error: null }),
        remove: async (paths) => {
          for (const p of paths) files.delete(p);
          return { error: null };
        },
      }),
    },
  };
  return { client, files };
}

describe("hostImages", () => {
  it("tải từng ảnh lên, trả link HTTPS theo cid; tên file có ngày và ngẫu nhiên", async () => {
    const f = fake();
    const r = await hostImages(f.client, [png("a@x"), png("b@x")], new Date("2025-11-03T00:00:00Z"));
    expect(Object.keys(r!)).toEqual(["a@x", "b@x"]);
    for (const url of Object.values(r!)) expect(url).toMatch(/^https:\/\/.*\/report-images\/20251103-[0-9a-f-]{36}\.png$/);
    expect(new Set(Object.values(r!)).size).toBe(2);
    expect(f.files.size).toBe(2);
  });
  it("lỗi tải lên (vd chưa chạy migration): trả null và dọn các ảnh đã tải của thư đó", async () => {
    const f = fake({ failAt: 1 });
    expect(await hostImages(f.client, [png("a@x"), png("b@x")])).toBeNull();
    expect(f.files.size).toBe(0);
  });
  it("link không phải HTTPS thì không dùng", async () => {
    expect(await hostImages(fake({ httpUrl: true }).client, [png("a@x")])).toBeNull();
  });
  it("chỉ nhận PNG; không có ảnh thì trả rỗng; client hỏng không ném lỗi", async () => {
    expect(await hostImages(fake().client, [{ ...png("a@x"), contentType: "image/svg+xml" }])).toBeNull();
    expect(await hostImages(fake().client, [])).toEqual({});
    expect(await hostImages({} as StorageLike, [png("a@x")])).toBeNull();
  });
});

describe("useHostedUrls", () => {
  it("thay cid: bằng link", () => {
    expect(useHostedUrls('<img src="cid:a@x"><img src="cid:b@x">', { "a@x": "https://h/1.png", "b@x": "https://h/2.png" }))
      .toBe('<img src="https://h/1.png"><img src="https://h/2.png">');
  });
});

describe("purgeOldReportImages", () => {
  it("xoá file cũ hơn 30 ngày theo ngày trong tên, giữ file mới và file lạ", async () => {
    const f = fake({ files: ["20251001-a.png", "20251020-b.png", "20251110-c.png", "khac.png"] });
    const removed = await purgeOldReportImages(f.client, new Date("2025-11-12T00:00:00Z"));
    expect(removed).toBe(1);
    expect([...f.files].sort()).toEqual(["20251020-b.png", "20251110-c.png", "khac.png"]);
  });
  it("lỗi thì trả 0, không ném", async () => {
    expect(await purgeOldReportImages({} as StorageLike)).toBe(0);
  });
});
