/** dd/mm/yyyy HH:mm theo giờ Việt Nam (cùng kết quả ở máy chủ và trình duyệt nên không lệch khi hydrate); trống hoặc sai thì "—". */
export function vnDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const o: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d)) o[p.type] = p.value;
  return `${o.day}/${o.month}/${o.year} ${o.hour}:${o.minute}`;
}
