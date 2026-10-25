import type { DB, Material, Task } from '../types';
import { committedFor, inventoryValue, isLowStock, isOverdue, paidFor, plannedProgress, projectProgress } from './calc';
import { isBehind } from './summary';
import { addDays } from './dates';
import { budgetPosition } from './finance';
import { sumMoney } from './money';
/** Every dashboard number comes from here, so other pages/reports can reuse (and tests can pin) the same rules. */
export interface DashboardFilter { project?: number | ''; horizonDays?: number }
export function dashboardMetrics(db: DB, today: string, f: DashboardFilter = {}) {
  const projects = db.P.filter((p) => p.status !== 'Archived' && (!f.project || p.id === f.project)), ids = new Set(projects.map((p) => p.id));
  const tasks = db.T.filter((t) => ids.has(t.p));
  const progresses = projects.map((p) => projectProgress(db.T.filter((t) => t.p === p.id))).filter((x): x is number => x !== null);
  const paid = sumMoney(projects.map((p) => paidFor(db.E, p.id))), committed = sumMoney(projects.map((p) => committedFor(db.E, p.id))), allocated = sumMoney(projects.map((p) => p.budget));
  const open = tasks.filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled');
  const horizon = addDays(today, f.horizonDays ?? 14);
  const upcoming: Task[] = open.filter((t) => t.due >= today && t.due <= horizon).sort((a, b) => a.due.localeCompare(b.due));
  const low: Material[] = db.I.filter(isLowStock);
  const active = db.M.filter((m) => m.active);
  const load = active.map((m) => ({ name: m.name, role: m.role, open: open.filter((t) => t.who === m.name).length })).sort((a, b) => b.open - a.open);
  return {
    projects, delayed: projects.filter((p) => p.status !== 'Completed' && (isBehind(projectProgress(db.T.filter((t) => t.p === p.id)), plannedProgress(p, today)) || open.some((t) => t.p === p.id && isOverdue(t, today)))), total: projects.length, active: projects.filter((p) => p.status === 'Active').length, completed: db.P.filter((p) => p.status === 'Completed' && (!f.project || p.id === f.project)).length,
    progress: progresses.length ? Math.round(progresses.reduce((a, b) => a + b, 0) / progresses.length) : null,
    budget: { ...budgetPosition(allocated, paid, committed) }, overdue: open.filter((t) => isOverdue(t, today)), blocked: open.filter((t) => t.status === 'Blocked'), upcoming, low, inventoryValue: inventoryValue(db.I),
    workforce: { active: active.length, inactive: db.M.length - active.length, busy: load.filter((l) => l.open > 0).length, load },
  };
}
