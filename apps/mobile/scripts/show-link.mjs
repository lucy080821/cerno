// In link exp://<IP-LAN>:8081 để nhập tay vào Expo Go (khi camera hỏng) và copy vào clipboard.
import os from "node:os";
import { spawnSync } from "node:child_process";

const PORT = 8081;
const skip = /vethernet|virtualbox|vmware|wsl|docker|loopback|vpn|tailscale|hyper-v/i;

const candidates = [];
for (const [name, list] of Object.entries(os.networkInterfaces())) {
  if (skip.test(name)) continue;
  for (const i of list ?? []) {
    if (i.family === "IPv4" && !i.internal) candidates.push({ name, address: i.address });
  }
}
// Ưu tiên dải mạng gia đình/văn phòng phổ biến
const rank = (a) => (a.startsWith("192.168.") ? 0 : a.startsWith("10.") ? 1 : a.startsWith("172.") ? 2 : 3);
candidates.sort((a, b) => rank(a.address) - rank(b.address));

if (!candidates.length) {
  console.log("Không tìm thấy IP mạng LAN. Dùng: npm run tunnel -w @dashboard/mobile");
} else {
  const url = `exp://${candidates[0].address}:${PORT}`;
  if (process.platform === "win32") spawnSync("clip", { input: url });
  console.log("\n==============================================");
  console.log(" Link cho Expo Go (đã copy vào clipboard):");
  console.log(`   ${url}`);
  console.log(" Cách 1: Expo Go → 'Enter URL manually' → dán link");
  console.log(" Cách 2: gửi link vào Notes/Zalo/Telegram, mở trên iPhone");
  if (candidates.length > 1) console.log(` (IP khác nếu link trên không vào được: ${candidates.slice(1).map((c) => c.address).join(", ")})`);
  console.log("==============================================\n");
}
