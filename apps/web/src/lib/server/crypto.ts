import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. Khoá 32 byte (base64) trong TOKEN_ENCRYPTION_KEY. Tạo: openssl rand -base64 32
function key(): Buffer {
  const b = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (b.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY phải là 32 byte, mã hoá base64");
  return b;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((x) => x.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split(".").map((x) => Buffer.from(x, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
