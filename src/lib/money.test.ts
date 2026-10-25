import { describe, expect, it } from 'vitest';
import { formatMoney, isMoneyAmount, isQuantity, mulMoney, subMoney, sumMoney } from './money';
import { budgetPosition, deleteExpense, markExpensePaid, saveExpense, monthlyTotals, netTotal } from './finance';
import { committedFor, inventoryValue, paidFor, remainingBudget } from './calc';
import { freshDb } from './fixtures';
const base = { p: 1, cat: 'Labor', vendor: 'Acme Ltd', date: '2026-10-01', amt: 100, status: 'Pending' as const };
describe('money precision', () => {
  it('sums without binary float drift', () => { expect(0.1 + 0.2).not.toBe(0.3); expect(sumMoney([0.1, 0.2])).toBe(0.3); expect(sumMoney(Array(10).fill(0.1))).toBe(1); expect(subMoney(0.3, 0.1)).toBe(0.2); });
  it('multiplies quantity by price to the nearest paisa', () => { expect(mulMoney(3, 0.1)).toBe(0.3); expect(mulMoney(0.333, 3)).toBe(1); expect(inventoryValue([{ qty: 3, cost: 0.1 }, { qty: 3, cost: 0.2 }])).toBe(0.9); });
  it('validates amounts', () => { expect(isMoneyAmount(10.25)).toBe(true); expect(isMoneyAmount(10.255)).toBe(false); expect(isMoneyAmount(0)).toBe(false); expect(isMoneyAmount(0, { allowZero: true })).toBe(true); expect(isMoneyAmount(-1)).toBe(false); expect(isMoneyAmount(NaN)).toBe(false); expect(isMoneyAmount(Infinity)).toBe(false); expect(isMoneyAmount(1e14)).toBe(false); });
  it('validates quantities', () => { expect(isQuantity(1.5)).toBe(true); expect(isQuantity(0.0001)).toBe(false); expect(isQuantity(0)).toBe(false); expect(isQuantity(0, { allowZero: true })).toBe(true); });
  it('formats consistently', () => { expect(formatMoney(1234567, 'PKR')).toBe('PKR 1,234,567'); expect(formatMoney(1234.5, 'USD')).toBe('USD 1,234.50'); expect(formatMoney(NaN, 'PKR')).toBe('PKR 0'); });
  it('remaining budget is exact', () => expect(remainingBudget(1, 0.9)).toBe(0.1));
});
describe('budget rules', () => {
  it('distinguishes allocated, paid, committed, remaining and available', () => { const b = budgetPosition(100, 60, 30); expect([b.allocated, b.paid, b.committed, b.remaining, b.available, b.utilization, b.overBudget]).toEqual([100, 60, 30, 40, 10, 60, false]); });
  it('handles over-budget, zero and missing budgets', () => { expect(budgetPosition(100, 80, 30).overBudget).toBe(true); expect(budgetPosition(0, 0, 0).alert).toBeNull(); expect(budgetPosition(0, 5, 0).utilization).toBeNull(); expect(budgetPosition(0, 5, 0).overBudget).toBe(true); expect(budgetPosition(100, 150, 0).utilization).toBe(150); });
  it('adds a valid expense with a unique reference', () => { const d = freshDb(), n = d.E.length, x = saveExpense(d, base); expect(d.E).toHaveLength(n + 1); expect(x.ref).toBe('EXP-1013'); });
  it('rejects invalid amounts, dates, vendors and unknown projects without changing data', () => {
    const d = freshDb(), n = d.E.length;
    for (const bad of [{ amt: 0 }, { amt: -5 }, { amt: 1.234 }, { amt: NaN }, { date: '2026-02-30' }, { vendor: ' a ' }, { p: 999 }, { cat: 'Nope' }]) expect(() => saveExpense(d, { ...base, ...bad })).toThrow();
    expect(d.E).toHaveLength(n);
  });
  it('rejects duplicate submissions but allows a different invoice number', () => { const d = freshDb(); saveExpense(d, base); expect(() => saveExpense(d, { ...base, vendor: ' ACME ltd ' })).toThrow(/already exists/); expect(() => saveExpense(d, { ...base, inv: 'INV-2' })).not.toThrow(); });
  it('refunds reduce net spend and cannot exceed what was paid', () => {
    const d = freshDb(), before = paidFor(d.E, 1);
    saveExpense(d, { ...base, vendor: 'Refund Co', amt: 1e6, status: 'Paid', refund: true });
    expect(paidFor(d.E, 1)).toBe(before - 1e6);
    expect(() => saveExpense(d, { ...base, vendor: 'Too Much', date: '2026-10-02', amt: before, status: 'Paid', refund: true })).toThrow(/exceeds/);
    expect(() => saveExpense(d, { ...base, vendor: 'Pend Refund', date: '2026-10-03', refund: true })).toThrow(/Paid/);
  });
  it('paid expenses are locked; pending ones can be edited, paid and deleted', () => {
    const d = freshDb(), paid = d.E.find((x) => x.status === 'Paid')!, pend = d.E.find((x) => x.status === 'Pending')!;
    expect(() => saveExpense(d, { p: paid.p, cat: paid.cat, vendor: paid.vendor, date: paid.date, amt: paid.amt + 1, status: 'Paid' }, paid.id)).toThrow(/locked/);
    expect(() => deleteExpense(d, paid.id)).toThrow();
    saveExpense(d, { p: pend.p, cat: pend.cat, vendor: pend.vendor, date: pend.date, amt: pend.amt + 5, status: 'Pending' }, pend.id);
    markExpensePaid(d, pend.id); expect(pend.status).toBe('Paid'); expect(committedFor(d.E, pend.p)).toBe(0);
  });
  it('cannot post to an archived project', () => { const d = freshDb(); d.P[0]!.status = 'Archived'; expect(() => saveExpense(d, base)).toThrow(/archived/); });
  it('monthly totals and net total agree and treat refunds as negative', () => { const l = [{ date: '2026-01-02', amt: 10, refund: false }, { date: '2026-01-09', amt: 4, refund: true }, { date: '2026-02-01', amt: 1 }]; expect(monthlyTotals(l)).toEqual([{ month: '2026-01', total: 6 }, { month: '2026-02', total: 1 }]); expect(netTotal(l)).toBe(7); });
});
