import type { ReactNode } from 'react';
export function Table({ head, rows, empty = 'No records yet.' }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500">{head.map((h) => <th key={h} scope="col" className="p-2 font-medium">{h || <span className="sr-only">Actions</span>}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i} className="border-t whitespace-nowrap">{r.map((c, j) => <td key={j} className="p-2">{c}</td>)}</tr>)}</tbody></table></div>;
}
