import * as XLSX from "xlsx";

// Only ever writes a workbook we built ourselves from in-memory rows -- never
// calls XLSX.read()/readFile() on a file someone else produced, so the
// parser-side CVEs in this package (prototype pollution, ReDoS) tied to
// reading untrusted spreadsheets don't apply to how this app uses it.
export function downloadXlsx(filename: string, sheetName: string, rows: (string | number)[][]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename);
}

// Mirrors the filename sanitation a browser's own "Save As" would otherwise
// have to do -- strips characters that are invalid across Windows/macOS so a
// project name/number can be dropped straight into the filename.
export function sanitizeFilenamePart(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-");
}
