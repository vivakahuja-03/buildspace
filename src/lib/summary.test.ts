import { describe, expect, it } from 'vitest';
import { isBehind, projectSummary } from './summary';
import type { DB } from '../types';
const db = { P: [{ id: 1, name: 'A', mgr: 'M', loc: 'L', start: '2026-01-01', end: '2026-01-11', budget: 100, status: 'Active' }], T: [{ id: 1, p: 1, title: 't', who: 'w', status: 'In Progress', start: '2026-01-01', due: '2026-01-05', pct: 20, ms: false, dep: '' }], E: [{ id: 1, p: 1, cat: 'Labor', vendor: 'v', date: '2026-01-02', amt: 60, status: 'Paid', ref: 'r' }, { id: 2, p: 1, cat: 'Labor', vendor: 'v', date: '2026-01-03', amt: 50, status: 'Pending', ref: 'r2' }] } as Pick<DB, 'P' | 'T' | 'E'>;
describe('projectSummary', () => {
  it('derives progress, budget and delay flags from data', () => {
    const s = projectSummary(db, 1, '2026-01-08')!;
    expect(s.progress).toBe(20); expect(s.planned).toBe(70); expect(s.behind).toBe(true);
    expect(s.paid).toBe(60); expect(s.committed).toBe(50); expect(s.remaining).toBe(40); expect(s.utilization).toBe(60);
    expect(s.overBudgetRisk).toBe(true); expect(s.overdue).toBe(1);
  });
  it('returns null for unknown projects and tolerates small gaps', () => { expect(projectSummary(db, 9, '2026-01-08')).toBeNull(); expect(isBehind(65, 70)).toBe(false); expect(isBehind(null, 90)).toBe(false); });
});
