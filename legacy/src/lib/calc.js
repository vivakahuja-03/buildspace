// Business rules for BuildSpace. Pure functions, covered by tests/calc.test.js.
const day = 864e5;
export const duration = (start, due) => Math.max(1, Math.round((new Date(due) - new Date(start)) / day) + 1);
/** Project progress = duration-weighted mean of task completion; Completed tasks count as 100%. null if no tasks. */
export function projectProgress(tasks) {
  if (!tasks.length) return null;
  let w = 0, s = 0;
  for (const t of tasks) { const d = duration(t.start, t.due); w += d; s += d * (t.status === 'Completed' ? 100 : t.pct); }
  return Math.round(s / w);
}
export const budgetUtilization = (budget, paid) => (budget > 0 ? Math.round((100 * paid) / budget) : 0);
export const remainingBudget = (budget, paid) => budget - paid;
export const inventoryValue = (items) => items.reduce((s, m) => s + m.qty * m.cost, 0);
export const isLowStock = (m) => m.qty <= m.min;
/** Returns new quantity or throws on invalid stock operations. */
export function applyStock(qty, kind, amount) {
  if (!(amount > 0)) throw new Error('Quantity must be greater than 0');
  if (kind === 'out' && amount > qty) throw new Error('Insufficient stock');
  return kind === 'in' ? qty + amount : qty - amount;
}
/** True if making task `id` depend on `dep` would create a cycle (dep chain reaches id). */
export function wouldCycle(tasks, id, dep) {
  const seen = new Set(); let cur = dep;
  while (cur) { if (cur == id) return true; if (seen.has(cur)) return false; seen.add(cur); const t = tasks.find((x) => x.id == cur); cur = t && t.dep; }
  return false;
}
