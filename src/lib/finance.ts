import { EXPENSE_CATEGORIES, type DB, type Expense } from '../types';
import { toMinor, isMoneyAmount, sumMoney, subMoney } from './money';
import { isIsoDate } from './dates';
import { committedFor, paidFor, budgetUtilization } from './calc';
import { DomainError } from './errors';
import { nextId } from './ids';
const signed = (x: Pick<Expense, 'amt' | 'refund'>) => (x.refund ? -x.amt : x.amt);
export function monthlyTotals(list: Pick<Expense, 'date' | 'amt' | 'refund'>[]): { month: string; total: number }[] {
  const m = new Map<string, number[]>();
  for (const x of list) { const k = x.date.slice(0, 7); m.set(k, [...(m.get(k) ?? []), signed(x)]); }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, total: sumMoney(v) }));
}
export function totalsByCategory(list: Pick<Expense, 'cat' | 'amt' | 'refund'>[]): { cat: string; total: number }[] {
  const m = new Map<string, number[]>();
  for (const x of list) m.set(x.cat, [...(m.get(x.cat) ?? []), signed(x)]);
  return [...m.entries()].map(([cat, v]) => ({ cat, total: sumMoney(v) })).sort((a, b) => b.total - a.total);
}
export const netTotal = (list: Pick<Expense, 'amt' | 'refund'>[]): number => sumMoney(list.map(signed));
type Candidate = Pick<Expense, 'p' | 'vendor' | 'date' | 'amt'> & { inv?: string };
const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();
/** Same project, vendor, date, amount and invoice number as an existing expense (other than `ignoreId`). */
export const isDuplicateExpense = (list: (Candidate & { id: number })[], c: Candidate, ignoreId?: number): boolean =>
  list.some((x) => x.id !== ignoreId && x.p === c.p && x.date === c.date && toMinor(x.amt) === toMinor(c.amt) && norm(x.vendor) === norm(c.vendor) && norm(x.inv) === norm(c.inv));
export function nextRef(list: Pick<Expense, 'ref'>[]): string {
  const n = Math.max(1000, ...list.map((x) => Number(/(\d+)$/.exec(x.ref)?.[1] ?? 0)));
  return `EXP-${n + 1}`;
}
/** 'over' = paid + committed exceeds budget; 'high' = paid above 90% of budget. */
export function budgetAlert(budget: number, paid: number, committed: number): 'over' | 'high' | null {
  if (toMinor(paid) + toMinor(committed) > toMinor(budget)) return 'over';
  return budget > 0 && paid / budget > 0.9 ? 'high' : null;
}
/** Single definition of the four budget figures used by dashboard, project detail and reports. */
export function budgetPosition(budget: number, paid: number, committed: number) {
  return { allocated: budget, paid, committed, remaining: subMoney(budget, paid), available: subMoney(subMoney(budget, paid), committed), utilization: budgetUtilization(budget, paid), alert: budgetAlert(budget, paid, committed), overBudget: budgetAlert(budget, paid, committed) === 'over' };
}
export interface ExpenseInput { p: number; cat: string; vendor: string; date: string; amt: number; status: 'Paid' | 'Pending'; refund?: boolean; inv?: string; notes?: string }
/** Creates or edits an expense inside `d`. Throws DomainError (changing nothing) on invalid input. */
export function saveExpense(d: DB, input: ExpenseInput, editingId?: number): Expense {
  const proj = d.P.find((x) => x.id === input.p), old = editingId === undefined ? undefined : d.E.find((x) => x.id === editingId);
  if (editingId !== undefined && !old) throw new DomainError('Expense not found');
  if (!proj) throw new DomainError('Choose a valid project');
  if (proj.status === 'Archived' && (!old || old.p !== input.p)) throw new DomainError('Cannot record expenses against an archived project');
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(input.cat)) throw new DomainError('Choose a valid category');
  const vendor = input.vendor.trim().replace(/\s+/g, ' '), inv = (input.inv ?? '').trim(), notes = (input.notes ?? '').trim();
  if (vendor.length < 2 || vendor.length > 80) throw new DomainError('Vendor must be 2-80 characters');
  if (inv.length > 40 || notes.length > 300) throw new DomainError('Invoice number (max 40) or notes (max 300) too long');
  if (!isIsoDate(input.date)) throw new DomainError('Enter a valid date');
  if (!isMoneyAmount(input.amt)) throw new DomainError('Amount must be greater than 0 with at most 2 decimal places');
  if (input.status !== 'Paid' && input.status !== 'Pending') throw new DomainError('Invalid status');
  const refund = !!input.refund;
  if (refund && input.status !== 'Paid') throw new DomainError('A refund/reversal must be recorded as Paid');
  if (old && old.status === 'Paid' && (old.p !== input.p || toMinor(old.amt) !== toMinor(input.amt) || old.date !== input.date || input.status !== 'Paid' || !!old.refund !== refund))
    throw new DomainError('Paid expenses are locked. Record a refund/reversal instead of changing project, date, amount or type.');
  if (old && old.status === 'Pending' && input.status === 'Paid' && refund) throw new DomainError('Invalid change');
  const cand: Candidate = { p: input.p, vendor, date: input.date, amt: input.amt, inv };
  if (isDuplicateExpense(d.E, cand, editingId)) throw new DomainError('An expense with the same project, vendor, date, amount and invoice number already exists');
  if (refund) {
    const others = d.E.filter((x) => x.p === input.p && x.id !== editingId);
    if (toMinor(input.amt) > toMinor(paidFor(others, input.p))) throw new DomainError('Refund exceeds the amount paid on this project');
  }
  const rec = { p: input.p, cat: input.cat, vendor, date: input.date, amt: input.amt, status: input.status, inv: inv || undefined, notes: notes || undefined, refund: refund || undefined };
  if (old) { Object.assign(old, rec); return old; }
  const n: Expense = { id: nextId(d.E), ref: nextRef(d.E), ...rec }; d.E.push(n); return n;
}
export function markExpensePaid(d: DB, id: number): void {
  const x = d.E.find((y) => y.id === id);
  if (!x) throw new DomainError('Expense not found');
  if (x.status === 'Paid') return;
  x.status = 'Paid';
}
export function deleteExpense(d: DB, id: number): void {
  const x = d.E.find((y) => y.id === id);
  if (!x) throw new DomainError('Expense not found');
  if (x.status === 'Paid') throw new DomainError('Paid expenses cannot be deleted. Record a refund/reversal instead.');
  d.E = d.E.filter((y) => y.id !== id);
}
export { committedFor };
