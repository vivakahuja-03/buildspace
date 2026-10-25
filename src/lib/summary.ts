import type { DB } from '../types';
import { committedFor, isOverdue, paidFor, plannedProgress, projectProgress } from './calc';
import { budgetPosition } from './finance';
/** A project is "behind" when actual progress trails planned (elapsed-time) progress by more than this many points. */
export const BEHIND_TOLERANCE = 10;
export const isBehind = (actual: number | null, planned: number): boolean => actual !== null && actual + BEHIND_TOLERANCE < planned;
export function projectSummary(db: Pick<DB, 'P' | 'T' | 'E'>, id: number, today: string) {
  const project = db.P.find((p) => p.id === id);
  if (!project) return null;
  const tasks = db.T.filter((t) => t.p === id), progress = projectProgress(tasks), planned = plannedProgress(project, today);
  const paid = paidFor(db.E, id), committed = committedFor(db.E, id), b = budgetPosition(project.budget, paid, committed);
  return { project, tasks, progress, planned, behind: isBehind(progress, planned), paid, committed, utilization: b.utilization, remaining: b.remaining, available: b.available, overBudgetRisk: b.overBudget, overdue: tasks.filter((t) => isOverdue(t, today)).length };
}
