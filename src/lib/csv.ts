export type Cell = string | number | null | undefined;
/** RFC 4180 CSV. Text cells that start with a formula character are prefixed with ' so spreadsheets do not execute them. */
export function toCsv(rows: Cell[][]): string {
  const cell = (c: Cell): string => {
    let s = c === null || c === undefined ? '' : String(c);
    if (typeof c === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
