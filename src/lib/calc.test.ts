import { describe, expect, it } from 'vitest';
import * as c from './calc';
describe('calc', () => {
  it('progress is duration weighted', () => {
    const t = [{ start: '2026-01-01', due: '2026-01-10', status: 'Completed' as const, pct: 40 }, { start: '2026-01-11', due: '2026-01-30', status: 'In Progress' as const, pct: 50 }];
    expect(c.projectProgress(t)).toBe(Math.round((10 * 100 + 20 * 50) / 30));
    expect(c.projectProgress([])).toBeNull();
  });
  it('planned progress is clamped', () => {
    expect(c.plannedProgress({ start: '2026-01-01', end: '2026-01-11' }, '2025-12-01')).toBe(0);
    expect(c.plannedProgress({ start: '2026-01-01', end: '2026-01-11' }, '2026-01-06')).toBe(50);
    expect(c.plannedProgress({ start: '2026-01-01', end: '2026-01-11' }, '2027-01-01')).toBe(100);
  });
  it('budget math', () => { expect(c.budgetUtilization(200, 50)).toBe(25); expect(c.budgetUtilization(0, 5)).toBeNull(); expect(c.budgetUtilization(0, 0)).toBe(0); expect(c.remainingBudget(200, 50)).toBe(150); });
  it('paid and committed are separate', () => {
    const e = [{ p: 1, amt: 10, status: 'Paid' }, { p: 1, amt: 5, status: 'Pending' }, { p: 2, amt: 7, status: 'Paid' }] as never[];
    expect(c.paidFor(e, 1)).toBe(10); expect(c.committedFor(e, 1)).toBe(5);
  });
  it('inventory', () => { expect(c.inventoryValue([{ qty: 2, cost: 10 }, { qty: 3, cost: 5 }])).toBe(35); expect(c.isLowStock({ qty: 5, min: 5 })).toBe(true); expect(c.isLowStock({ qty: 6, min: 5 })).toBe(false); });
  it('stock operations are validated', () => {
    expect(c.applyStock(10, 'in', 5)).toBe(15); expect(c.applyStock(10, 'out', 4)).toBe(6);
    expect(() => c.applyStock(3, 'out', 4)).toThrow(); expect(() => c.applyStock(3, 'in', 0)).toThrow();
  });
  it('detects circular dependencies', () => {
    const T = [{ id: 1, dep: '' as const }, { id: 2, dep: 1 }, { id: 3, dep: 2 }];
    expect(c.wouldCycle(T, 1, 3)).toBe(true); expect(c.wouldCycle(T, 2, 2)).toBe(true); expect(c.wouldCycle(T, 3, 1)).toBe(false);
  });
});
