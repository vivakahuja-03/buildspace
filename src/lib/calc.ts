import type { Expense, Material, Project, Task } from '../types';
import { diffDays, toDay } from './dates';
import { mulMoney, roundQty, sumMoney } from './money';
/** Inclusive length in days; at least 1 (zero-length, reversed or unparseable ranges count as 1 day). */
export const duration = (start: string, due: string): number => { const d = diffDays(start, due); return Number.isFinite(d) ? Math.max(1, d + 1) : 1; };
export const clampPct = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);
/** Completion of a single task: Completed = 100, otherwise the clamped percentage (invalid values count as 0). */
export const taskCompletion = (t: Pick<Task, 'status' | 'pct'>): number => (t.status === 'Completed' ? 100 : clampPct(t.pct));
/** Duration-weighted mean of task completion, always within 0-100. Cancelled tasks are excluded; null when nothing is left to measure. */
export function projectProgress(tasks: Pick<Task, 'start' | 'due' | 'status' | 'pct'>[]): number | null {
  const live = tasks.filter((t) => t.status !== 'Cancelled');
  if (!live.length) return null;
  let w = 0, s = 0;
  for (const t of live) { const d = duration(t.start, t.due); w += d; s += d * taskCompletion(t); }
  return Math.min(100, Math.max(0, Math.round(s / w)));
}
/** Share of the project's time window that has elapsed, 0-100 (an estimate, not measured work). */
export function plannedProgress(p: Pick<Project, 'start' | 'end'>, today: string): number {
  const span = toDay(p.end) - toDay(p.start), elapsed = toDay(today) - toDay(p.start);
  if (!Number.isFinite(span) || !Number.isFinite(elapsed)) return 0;
  return span <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((100 * elapsed) / span)));
}
/** % of budget paid. A zero/missing budget with spending returns null ("no budget"), never a misleading 0%. */
export const budgetUtilization = (budget: number, paid: number): number | null => (budget > 0 ? Math.round((100 * paid) / budget) : paid > 0 ? null : 0);
export const remainingBudget = (budget: number, paid: number): number => sumMoney([budget, -paid]);
const signed = (x: Pick<Expense, 'amt' | 'refund'>) => (x.refund ? -x.amt : x.amt);
/** Net paid expenditure for a project (paid refunds reduce it). */
export const paidFor = (e: Expense[], p: number): number => sumMoney(e.filter((x) => x.p === p && x.status === 'Paid').map(signed));
/** Committed = pending (not yet paid) expenses. */
export const committedFor = (e: Expense[], p: number): number => sumMoney(e.filter((x) => x.p === p && x.status === 'Pending' && !x.refund).map((x) => x.amt));
export const inventoryValue = (items: Pick<Material, 'qty' | 'cost'>[]): number => sumMoney(items.map((m) => mulMoney(m.qty, m.cost)));
export const isLowStock = (m: Pick<Material, 'qty' | 'min'>): boolean => m.qty <= m.min;
export const isOverdue = (t: Pick<Task, 'status' | 'due'>, today: string): boolean => t.status !== 'Completed' && t.status !== 'Cancelled' && t.due < today;
export function applyStock(qty: number, kind: 'in' | 'out', amount: number): number {
  if (!(typeof amount === 'number' && Number.isFinite(amount) && amount > 0)) throw new Error('Quantity must be greater than 0');
  if (kind === 'out' && roundQty(amount) > roundQty(qty)) throw new Error('Insufficient stock');
  return roundQty(kind === 'in' ? qty + amount : qty - amount);
}
/** True if making `id` depend on `dep` would create a cycle. */
export function wouldCycle(tasks: Pick<Task, 'id' | 'dep'>[], id: number, dep: number): boolean {
  const seen = new Set<number>(); let cur: number | '' | undefined = dep;
  while (cur) { if (cur === id) return true; if (seen.has(cur)) return false; seen.add(cur); const c: number = cur; cur = tasks.find((x) => x.id === c)?.dep; }
  return false;
}
