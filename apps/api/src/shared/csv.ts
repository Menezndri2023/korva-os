/** A spreadsheet cell: text, number, or nothing. */
export type CsvCell = string | number | null | undefined;

/** Byte order mark: without it Excel reads the UTF-8 file as Latin-1 and breaks every accent. */
const BOM = String.fromCharCode(0xfeff);

/** A cell for French Excel: semicolons and quotes escaped, decimal comma. */
function cell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'number' ? String(value).replace('.', ',') : value;
  // A leading =, +, - or @ would be read by Excel as a formula (CSV injection): prefix a quote.
  const safe =
    /^[=+\-@]/.test(text) && typeof value !== 'number' ? `'${text}` : text;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A CSV that Excel opens directly, accents and decimal commas included. */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(cell).join(';'));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
