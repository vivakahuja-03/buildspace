import { describe, expect, it } from 'vitest';
import { budgetAlert, isDuplicateExpense, monthlyTotals, nextRef, totalsByCategory } from './finance';
const e = [{ id: 1, p: 1, vendor: 'Acme', date: '2026-02-03', amt: 10, cat: 'Labor', ref: 'EXP-1001' }, { id: 2, p: 1, vendor: 'Beta', date: '2026-01-05', amt: 5, cat: 'Labor', ref: 'EXP-1010' }, { id: 3, p: 2, vendor: 'Beta', date: '2026-02-09', amt: 7, cat: 'Permits', ref: 'EXP-1003' }];
describe('finance', () => {
  it('groups by month in order and by category', () => {
    expect(monthlyTotals(e)).toEqual([{ month: '2026-01', total: 5 }, { month: '2026-02', total: 17 }]);
    expect(totalsByCategory(e)).toEqual([{ cat: 'Labor', total: 15 }, { cat: 'Permits', total: 7 }]);
  });
  it('totals agree with the raw records', () => expect(monthlyTotals(e).reduce((s, x) => s + x.total, 0)).toBe(e.reduce((s, x) => s + x.amt, 0)));
  it('detects duplicates but ignores the record being edited', () => {
    const c = { p: 1, vendor: ' acme ', date: '2026-02-03', amt: 10 };
    expect(isDuplicateExpense(e, c)).toBe(true); expect(isDuplicateExpense(e, c, 1)).toBe(false); expect(isDuplicateExpense(e, { ...c, amt: 11 })).toBe(false);
  });
  it('generates the next unique reference', () => expect(nextRef(e)).toBe('EXP-1011'));
  it('flags budget risk', () => { expect(budgetAlert(100, 60, 50)).toBe('over'); expect(budgetAlert(100, 95, 0)).toBe('high'); expect(budgetAlert(100, 50, 10)).toBeNull(); });
});
