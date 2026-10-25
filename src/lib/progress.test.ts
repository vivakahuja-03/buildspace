import { describe, expect, it } from 'vitest';
import { clampPct, duration, isOverdue, plannedProgress, projectProgress, taskCompletion } from './calc';
const t = (status: string, pct: number, start = '2026-01-01', due = '2026-01-10') => ({ status: status as never, pct, start, due });
describe('progress edge cases', () => {
  it('no tasks -> null; all cancelled -> null', () => { expect(projectProgress([])).toBeNull(); expect(projectProgress([t('Cancelled', 50)])).toBeNull(); });
  it('cancelled tasks do not weigh the project down', () => expect(projectProgress([t('Completed', 0), t('Cancelled', 0, '2026-01-01', '2026-12-31')])).toBe(100));
  it('zero-duration and reversed ranges count as one day', () => { expect(duration('2026-01-05', '2026-01-05')).toBe(1); expect(duration('2026-01-09', '2026-01-01')).toBe(1); expect(duration('bad', '2026-01-01')).toBe(1); });
  it('invalid percentages are clamped to 0-100', () => { expect(clampPct(150)).toBe(100); expect(clampPct(-5)).toBe(0); expect(clampPct(NaN)).toBe(0); expect(clampPct('x')).toBe(0); expect(projectProgress([t('In Progress', 400), t('In Progress', NaN)])).toBe(50); });
  it('completed counts as 100 even with a stale pct', () => expect(taskCompletion(t('Completed', 10))).toBe(100));
  it('result always stays within 0-100', () => { for (const pct of [-1e9, 0, 33, 100, 1e9, NaN]) { const r = projectProgress([t('In Progress', pct)]) as number; expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(100); } });
  it('overdue ignores completed and cancelled tasks', () => { expect(isOverdue(t('To Do', 0), '2026-02-01')).toBe(true); expect(isOverdue(t('Completed', 100), '2026-02-01')).toBe(false); expect(isOverdue(t('Cancelled', 0), '2026-02-01')).toBe(false); });
  it('planned progress tolerates bad dates', () => { expect(plannedProgress({ start: 'x', end: 'y' }, '2026-01-01')).toBe(0); expect(plannedProgress({ start: '2026-01-01', end: '2026-01-01' }, '2026-01-01')).toBe(100); });
});
