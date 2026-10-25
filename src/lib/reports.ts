import { TASK_STATUSES, type DB, type Expense, type Material, type TaskStatus } from '../types';
import { committedFor, inventoryValue, isLowStock, isOverdue, paidFor, plannedProgress, projectProgress } from './calc';
import { isIsoDate } from './dates';
import { budgetPosition, monthlyTotals, netTotal, totalsByCategory } from './finance';
import { mulMoney, sumMoney } from './money';
import { openPurchaseValue } from './inventory';
import { isBehind } from './summary';
export interface ReportFilter { project: number | 'all'; from: string; to: string; expenseStatus: 'All' | 'Paid' | 'Pending' }
export const defaultFilter = (): ReportFilter => ({ project: 'all', from: '', to: '', expenseStatus: 'All' });
export function filterError(f: ReportFilter): string | null {
  if (f.from && !isIsoDate(f.from)) return 'The start date is not valid';
  if (f.to && !isIsoDate(f.to)) return 'The end date is not valid';
  if (f.from && f.to && f.from > f.to) return 'The start date must not be after the end date';
  return null;
}
const inRange = (date: string, f: ReportFilter) => (!f.from || date >= f.from) && (!f.to || date <= f.to);
/** Builds all report sections from live data. Returns null when the filter is invalid. Budget position is lifetime; expenses/usage/tasks honour the date range. */
export function buildReport(db: DB, f: ReportFilter, today: string) {
  if (filterError(f)) return null;
  const projects = db.P.filter((p) => (f.project === 'all' ? p.status !== 'Archived' : p.id === f.project)), ids = new Set(projects.map((p) => p.id));
  const rows = projects.map((p) => {
    const tasks = db.T.filter((t) => t.p === p.id), progress = projectProgress(tasks), planned = plannedProgress(p, today), paid = paidFor(db.E, p.id), committed = committedFor(db.E, p.id), b = budgetPosition(p.budget, paid, committed);
    return { id: p.id, name: p.name, status: p.status, progress, planned, behind: isBehind(progress, planned), ...b, tasksTotal: tasks.filter((t) => t.status !== 'Cancelled').length, tasksDone: tasks.filter((t) => t.status === 'Completed').length, overdue: tasks.filter((t) => isOverdue(t, today)).length };
  });
  const totals = { budget: sumMoney(rows.map((r) => r.allocated)), paid: sumMoney(rows.map((r) => r.paid)), committed: sumMoney(rows.map((r) => r.committed)), remaining: sumMoney(rows.map((r) => r.remaining)) };
  const expenses: Expense[] = db.E.filter((x) => ids.has(x.p) && inRange(x.date, f) && (f.expenseStatus === 'All' || x.status === f.expenseStatus)).sort((a, b) => b.date.localeCompare(a.date));
  const tasks = db.T.filter((t) => ids.has(t.p) && (!f.from || t.due >= f.from) && (!f.to || t.start <= f.to));
  const byStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, tasks.filter((t) => t.status === s).length])) as Record<TaskStatus, number>;
  const counted = tasks.filter((t) => t.status !== 'Cancelled');
  const usageMap = new Map<string, { name: string; qty: number; project: number | null }[]>();
  for (const r of db.MV) { if (r[2] !== 'Consumed' || typeof r[0] !== 'string' || !inRange(r[0], f)) continue; const pr = typeof r[4] === 'number' ? r[4] : null; if (f.project !== 'all' && pr !== f.project) continue; if (pr !== null && !db.P.some((p) => p.id === pr && ids.has(p.id)) ) continue; const n = String(r[1]); usageMap.set(n, [...(usageMap.get(n) ?? []), { name: n, qty: Number(r[3]), project: pr }]); }
  const usage = [...usageMap.entries()].map(([name, v]) => { const m: Material | undefined = db.I.find((x) => x.name === name), qty = Math.round(v.reduce((s, x) => s + x.qty, 0) * 1000) / 1000; return { name, unit: m?.unit ?? '', qty, estCost: m ? mulMoney(qty, m.cost) : 0 }; }).sort((a, b) => b.estCost - a.estCost);
  return {
    projects: rows, totals,
    expenses: { rows: expenses, total: netTotal(expenses), byCategory: totalsByCategory(expenses), byMonth: monthlyTotals(expenses) },
    tasks: { rows: tasks, total: counted.length, byStatus, completed: byStatus.Completed, completionRate: counted.length ? Math.round((100 * byStatus.Completed) / counted.length) : null, overdue: tasks.filter((t) => isOverdue(t, today)).length },
    materials: { usage, estCostTotal: sumMoney(usage.map((u) => u.estCost)) },
    inventory: { value: inventoryValue(db.I), low: db.I.filter(isLowStock) },
    purchases: (() => { const rows = db.PO.filter((o) => (o.p === undefined ? f.project === 'all' : ids.has(o.p)) && (!f.from || (o.date ?? '') >= f.from) && (!f.to || (o.date ?? '') <= f.to)); return { rows, byStatus: ['Requested', 'Approved', 'Ordered', 'Received', 'Cancelled'].map((s) => ({ status: s, count: rows.filter((o) => o.status === s).length })), openValue: sumMoney(projects.map((p) => openPurchaseValue(db, p.id))) }; })(),
    team: db.M.filter((m) => m.active).map((m) => ({ name: m.name, role: m.role, availability: m.availability ?? 'Available', open: tasks.filter((t) => t.who === m.name && t.status !== 'Completed' && t.status !== 'Cancelled').length, done: tasks.filter((t) => t.who === m.name && t.status === 'Completed').length })),
  };
}
export type Report = NonNullable<ReturnType<typeof buildReport>>;
