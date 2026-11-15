import { unzipSync } from "fflate";
import { MAX_FILE_COLUMNS, MAX_FILE_ROWS, MAX_UPLOAD_BYTES } from "./canonical";
import { FileError, decodeText, parseCsv } from "./csv";

export { FileError };

/** Giá trị một ô sau khi đọc: Excel trả số, ngày (Date), chữ; CSV chỉ trả chữ. */
export type RawCell = string | number | boolean | Date | null | undefined;
export type RawTable = RawCell[][];
export interface RawSheet {
  name: string;
  rows: RawTable;
}

/** Một file .xlsx là file nén: chặn "bom nén" (nhỏ khi nén nhưng phình ra rất lớn khi giải nén) trước khi đọc. */
const MAX_ENTRY_BYTES = 150 * 1024 * 1024;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const MAX_SHEETS = 10;

function guardZip(bytes: Uint8Array) {
  let total = 0;
  try {
    // filter trả false nên không giải nén gì cả, chỉ đọc danh mục file trong gói.
    unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (f.originalSize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) throw new FileError("File quá lớn sau khi giải nén. Hãy chia nhỏ theo thời gian rồi tải từng phần.");
        return false;
      },
    });
  } catch (e) {
    if (e instanceof FileError) throw e;
    throw new FileError("File Excel bị hỏng hoặc không đúng định dạng .xlsx.");
  }
}

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isLegacyXls = (b: Uint8Array) => b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

/**
 * Đọc mọi sheet của file Excel (.xlsx) hoặc CSV thành lưới ô. Không suy diễn nội dung: việc nhận diện cột nằm ở detect.ts.
 * File .xls đời cũ không hỗ trợ (cần lưu lại thành .xlsx hoặc .csv).
 */
export async function readSheets(data: Uint8Array, filename: string): Promise<RawSheet[]> {
  if (data.length === 0) throw new FileError("File trống.");
  if (data.length > MAX_UPLOAD_BYTES) throw new FileError(`File lớn hơn ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Hãy chia nhỏ theo thời gian rồi tải từng phần.`);

  if (isLegacyXls(data)) throw new FileError("Chưa hỗ trợ file .xls đời cũ. Hãy mở bằng Excel rồi Lưu thành .xlsx hoặc .csv.");

  if (isZip(data)) {
    guardZip(data);
    const { default: readExcelFile } = await import("read-excel-file/node");
    let sheets: { sheet: string; data: RawTable }[];
    try {
      sheets = (await readExcelFile(Buffer.from(data))) as { sheet: string; data: RawTable }[];
    } catch {
      throw new FileError("Không đọc được file Excel. Hãy thử mở rồi lưu lại bằng Excel.");
    }
    return sheets.slice(0, MAX_SHEETS).map((s) => {
      if (s.data.length > MAX_FILE_ROWS + 1) throw new FileError(`Sheet "${s.sheet}" có quá ${MAX_FILE_ROWS.toLocaleString("vi-VN")} dòng. Hãy chia nhỏ theo thời gian rồi tải từng phần.`);
      if (s.data.some((r) => r.length > MAX_FILE_COLUMNS)) throw new FileError(`Sheet "${s.sheet}" có quá ${MAX_FILE_COLUMNS} cột.`);
      return { name: s.sheet, rows: s.data };
    });
  }

  if (/\.xlsx?$/i.test(filename)) throw new FileError("File không đúng định dạng Excel .xlsx.");
  return [{ name: filename, rows: parseCsv(decodeText(data), MAX_FILE_ROWS, MAX_FILE_COLUMNS) }];
}
