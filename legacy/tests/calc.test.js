import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../src/lib/calc.js';
test('progress is duration weighted', () => {
  const t = [{ start: '2026-01-01', due: '2026-01-10', status: 'Completed', pct: 40 }, { start: '2026-01-11', due: '2026-01-30', status: 'In Progress', pct: 50 }];
  assert.equal(c.projectProgress(t), Math.round((10 * 100 + 20 * 50) / 30));
  assert.equal(c.projectProgress([]), null);
});
test('budget math', () => { assert.equal(c.budgetUtilization(200, 50), 25); assert.equal(c.budgetUtilization(0, 5), 0); assert.equal(c.remainingBudget(200, 50), 150); });
test('inventory value and low stock', () => {
  assert.equal(c.inventoryValue([{ qty: 2, cost: 10 }, { qty: 3, cost: 5 }]), 35);
  assert.ok(c.isLowStock({ qty: 5, min: 5 })); assert.ok(!c.isLowStock({ qty: 6, min: 5 }));
});
test('stock operations are validated', () => {
  assert.equal(c.applyStock(10, 'in', 5), 15); assert.equal(c.applyStock(10, 'out', 4), 6);
  assert.throws(() => c.applyStock(3, 'out', 4)); assert.throws(() => c.applyStock(3, 'in', 0));
});
test('circular dependencies are detected', () => {
  const T = [{ id: 1, dep: '' }, { id: 2, dep: 1 }, { id: 3, dep: 2 }];
  assert.ok(c.wouldCycle(T, 1, 3)); assert.ok(c.wouldCycle(T, 2, 2)); assert.ok(!c.wouldCycle(T, 3, 1));
});
