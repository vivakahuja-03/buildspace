import type { DB } from '../types';
import { addDays } from './dates';
import { committedFor, isLowStock, isOverdue, paidFor } from './calc';
export interface Hit { type: string; label: string; to: string }
export function searchAll(db: DB, q: string, limit = 50): Hit[] {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const has = (...v: (string | undefined)[]) => v.some((x) => (x ?? '').toLowerCase().includes(s));
  const hits: Hit[] = [
    ...db.P.filter((p) => has(p.name, p.loc, p.mgr)).map((p) => ({ type: 'Project', label: p.name, to: `/projects/${p.id}` })),
    ...db.T.filter((t) => has(t.title, t.who)).map((t) => ({ type: 'Task', label: t.title, to: '/tasks' })),
    ...db.M.filter((m) => has(m.name, m.role, m.dept)).map((m) => ({ type: 'Team', label: m.name, to: '/team' })),
    ...db.I.filter((m) => has(m.name, m.sku, m.cat, m.sup)).map((m) => ({ type: 'Material', label: `${m.name} (${m.sku})`, to: '/materials' })),
    ...db.E.filter((x) => has(x.vendor, x.ref, x.inv)).map((x) => ({ type: 'Expense', label: `${x.ref} ${x.vendor}`, to: '/budget' })),
    ...db.DOC.filter((x) => has(x.n, x.c)).map((x) => ({ type: 'Document', label: x.n, to: '/documents' })),
  ];
  return hits.slice(0, limit);
}
export interface Notice { level: 'bad' | 'warn'; text: string; to: string }
export function notifications(db: DB, today: string): Notice[] {
  const out: Notice[] = [], ids = new Set(db.P.filter((p) => p.status !== 'Archived').map((p) => p.id)), week = addDays(today, 7);
  const pn = (id: number) => db.P.find((p) => p.id === id)?.name ?? '—';
  for (const t of db.T) {
    if (!ids.has(t.p)) continue;
    if (isOverdue(t, today)) out.push({ level: 'bad', text: `Overdue task: ${t.title} (${pn(t.p)})`, to: '/tasks' });
    else if (t.status === 'Blocked') out.push({ level: 'warn', text: `Blocked task: ${t.title}`, to: '/tasks' });
    else if (t.status !== 'Completed' && t.status !== 'Cancelled' && t.due >= today && t.due <= week) out.push({ level: 'warn', text: `Due within 7 days: ${t.title} (${t.due})`, to: '/tasks' });
  }
  db.I.filter(isLowStock).forEach((m) => out.push({ level: m.qty === 0 ? 'bad' : 'warn', text: `${m.qty === 0 ? 'Out of stock' : 'Low stock'}: ${m.name}`, to: '/materials' }));
  db.P.filter((p) => p.status === 'Active' && Math.round(paidFor(db.E, p.id) * 100) + Math.round(committedFor(db.E, p.id) * 100) > Math.round(p.budget * 100)).forEach((p) => out.push({ level: 'bad', text: `Budget overrun risk: ${p.name}`, to: '/budget' }));
  return out;
}
