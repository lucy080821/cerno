/** Đọc CSV do người dùng tải lên: tự đoán mã hoá (UTF-8/UTF-16/Windows-1258) và dấu phân cách (, ; tab |). */

export class FileError extends Error {}

/** Giải mã byte thành chuỗi. Có BOM thì theo BOM, không thì thử UTF-8 chặt rồi lùi về bảng mã Windows tiếng Việt. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    for (const label of ["windows-1258", "windows-1252"]) {
      try {
        return new TextDecoder(label).decode(bytes);
      } catch {
        /* thử bảng mã kế tiếp */
      }
    }
    throw new FileError("Không đọc được mã hoá của file CSV. Hãy lưu lại ở dạng CSV UTF-8.");
  }
}

const DELIMITERS = [",", ";", "\t", "|"] as const;

/** Dấu phân cách xuất hiện nhiều nhất ở dòng đầu (bỏ qua phần trong ngoặc kép). */
export function detectDelimiter(text: string): string {
  const end = text.search(/\r?\n/);
  const head = end === -1 ? text : text.slice(0, end);
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best: string = ",";
  let bestN = 0;
  for (const [d, n] of counts) {
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

/** Tách CSV theo RFC 4180: ô trong ngoặc kép có thể chứa dấu phân cách, xuống dòng và `""`. */
export function parseCsv(text: string, maxRows: number, maxColumns: number): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const pushCell = () => {
    row.push(cell);
    cell = "";
    if (row.length > maxColumns) throw new FileError(`File có quá ${maxColumns} cột.`);
  };
  const pushRow = () => {
    pushCell();
    // Bỏ dòng hoàn toàn trống (thường là dòng cuối file).
    if (row.some((c) => c.trim() !== "")) {
      rows.push(row);
      if (rows.length > maxRows + 1) throw new FileError(`File có quá ${maxRows.toLocaleString("vi-VN")} dòng. Hãy chia nhỏ theo thời gian rồi tải từng phần.`);
    }
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) pushCell();
    else if (ch === "\n") pushRow();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
    } else cell += ch;
    i++;
  }
  if (cell !== "" || row.length > 0) pushRow();
  return rows;
}
