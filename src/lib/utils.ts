import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatMoney } from './money';
export const cn = (...i: ClassValue[]) => twMerge(clsx(i));
export const money = (n: number, cur: string) => formatMoney(n, cur);
export const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
export const fieldCls = 'mt-1 w-full rounded border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-600';
export const inlineField = `${fieldCls} !mt-0 !w-auto`;
export function downloadBlob(blob: Blob, name: string): void { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
export const newOpId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
