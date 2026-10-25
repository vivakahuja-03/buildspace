import { describe, expect, it } from 'vitest';
import { buildReport, defaultFilter, filterError } from './reports';
import { dashboardMetrics } from './metrics';
import { projectSummary } from './summary';
import { toCsv } from './csv';
import { STORAGE_KEY, exportBackup, importBackup, loadDb, normalizeDb } from './persistence';
import { asRole, can, canDeleteDocument, canViewDocument } from './permissions';
import { searchAll, notifications } from './search';
import { moveStock } from './inventory';
import { saveExpense } from './finance';
import { freshDb, TODAY_T } from './fixtures';
import { seed } from '../data/seed';
const store = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
describe('reports', () => {
  it('totals match the dashboard and project summaries', () => {
    const d = freshDb(), r = buildReport(d, defaultFilter(), TODAY_T)!, m = dashboardMetrics(d, TODAY_T);
    expect(r.totals.budget).toBe(m.budget.allocated); expect(r.totals.paid).toBe(m.budget.paid); expect(r.totals.committed).toBe(m.budget.committed); expect(r.totals.remaining).toBe(m.budget.remaining);
    for (const row of r.projects) { const s = projectSummary(d, row.id, TODAY_T)!; expect([row.progress, row.paid, row.committed, row.remaining, row.overdue]).toEqual([s.progress, s.paid, s.committed, s.remaining, s.overdue]); }
    expect(r.tasks.overdue).toBe(m.overdue.length); expect(r.inventory.low).toHaveLength(m.low.length);
  });
  it('expense sections reconcile with the underlying rows', () => { const d = freshDb(), r = buildReport(d, defaultFilter(), TODAY_T)!, sum = (v: { total: number }[]) => Math.round(v.reduce((s, x) => s + x.total, 0) * 100) / 100; expect(sum(r.expenses.byCategory)).toBe(r.expenses.total); expect(sum(r.expenses.byMonth)).toBe(r.expenses.total); expect(r.expenses.total).toBe(d.E.reduce((s, e) => s + e.amt, 0)); });
  it('filters by project, date range and expense status', () => {
    const d = freshDb(); const one = buildReport(d, { ...defaultFilter(), project: 2 }, TODAY_T)!; expect(one.projects).toHaveLength(1); expect(one.expenses.rows.every((e) => e.p === 2)).toBe(true);
    const aug = buildReport(d, { ...defaultFilter(), from: '2026-09-01', to: '2026-09-30' }, TODAY_T)!; expect(aug.expenses.rows.every((e) => e.date >= '2026-09-01' && e.date <= '2026-09-30')).toBe(true); expect(aug.expenses.rows.length).toBeGreaterThan(0);
    const pend = buildReport(d, { ...defaultFilter(), expenseStatus: 'Pending' }, TODAY_T)!; expect(pend.expenses.total).toBe(pend.totals.committed);
  });
  it('rejects invalid ranges and handles empty datasets', () => {
    const d = freshDb(); expect(filterError({ ...defaultFilter(), from: '2026-05-01', to: '2026-01-01' })).toMatch(/must not be after/); expect(filterError({ ...defaultFilter(), from: 'x' })).toMatch(/not valid/); expect(buildReport(d, { ...defaultFilter(), from: '2026-05-01', to: '2026-01-01' }, TODAY_T)).toBeNull();
    const none = buildReport(d, { ...defaultFilter(), from: '2000-01-01', to: '2000-01-02' }, TODAY_T)!; expect(none.expenses.rows).toHaveLength(0); expect(none.expenses.total).toBe(0); expect(none.tasks.completionRate).toBeNull();
    const empty = freshDb(); empty.P = []; empty.T = []; empty.E = []; const e = buildReport(empty, defaultFilter(), TODAY_T)!; expect(e.projects).toHaveLength(0); expect(e.totals.budget).toBe(0); expect(dashboardMetrics(empty, TODAY_T).progress).toBeNull();
  });
  it('material usage comes from consumption records and is date/project filtered', () => {
    const d = freshDb(); moveStock(d, { id: 1, kind: 'out', qty: 10, today: '2026-10-01', project: 1 }); moveStock(d, { id: 1, kind: 'out', qty: 5, today: '2026-10-02', project: 2 }); moveStock(d, { id: 1, kind: 'in', qty: 100, today: '2026-10-03' });
    const all = buildReport(d, defaultFilter(), TODAY_T)!; expect(all.materials.usage[0]).toEqual({ name: 'Cement bags (50kg)', unit: 'bag', qty: 15, estCost: 21750 });
    expect(buildReport(d, { ...defaultFilter(), project: 1 }, TODAY_T)!.materials.usage[0]?.qty).toBe(10); expect(buildReport(d, { ...defaultFilter(), from: '2026-10-02' }, TODAY_T)!.materials.usage[0]?.qty).toBe(5);
  });
  it('dashboard reacts to changes in other modules and ignores archived projects', () => {
    const d = freshDb(), before = dashboardMetrics(d, TODAY_T); saveExpense(d, { p: 1, cat: 'Labor', vendor: 'New Vendor', date: TODAY_T, amt: 1000, status: 'Paid' }); expect(dashboardMetrics(d, TODAY_T).budget.paid).toBe(before.budget.paid + 1000);
    d.P.find((p) => p.id === 2)!.status = 'Archived'; expect(dashboardMetrics(d, TODAY_T).total).toBe(before.total - 1); expect(dashboardMetrics(d, TODAY_T).overdue.every((t) => t.p !== 2)).toBe(true);
  });
  it('workforce and upcoming deadlines', () => { const d = freshDb(), m = dashboardMetrics(d, TODAY_T); expect(m.workforce.active).toBe(7); expect(m.workforce.inactive).toBe(1); expect(m.upcoming.every((t) => t.due >= TODAY_T && t.status !== 'Completed')).toBe(true); });
});
describe('csv', () => {
  it('quotes, escapes and neutralises formulas', () => { expect(toCsv([['a,b', 'say "hi"', 'line\nbreak'], [1, null, undefined]])).toBe('"a,b","say ""hi""","line\nbreak"\r\n"1","",""'); expect(toCsv([['=SUM(A1)', '+1', '-x', '@a'], [-5]])).toBe(`"'=SUM(A1)","'+1","'-x","'@a"\r\n"-5"`); });
});
describe('persistence and recovery', () => {
  it('first run loads the seed; saved data round-trips', () => { const s = store(), r = loadDb(s); expect(r.db.P).toHaveLength(5); expect(r.notice).toBe(''); const d = freshDb(); d.cur = 'USD'; s.setItem(STORAGE_KEY, JSON.stringify(d)); expect(loadDb(s).db.cur).toBe('USD'); });
  it('corrupt JSON is backed up, not destroyed, and demo data loads', () => { const s = store({ [STORAGE_KEY]: '{not json' }), r = loadDb(s, 42); expect(r.db.P).toHaveLength(5); expect(r.notice).toMatch(/copy was kept/); expect(s.m.get(`${STORAGE_KEY}-corrupt-42`)).toBe('{not json'); });
  it('wrong-shaped data is treated as corrupt', () => { const s = store({ [STORAGE_KEY]: '{"hello":1}' }); expect(loadDb(s).notice).toMatch(/could not be read/); });
  it('a failing or unavailable storage does not crash', () => { expect(loadDb({ getItem: () => { throw new Error('denied'); }, setItem: () => undefined }).notice).toMatch(/unavailable/); });
  it('repairs bad values and reports what it fixed', () => {
    const d = freshDb() as any; d.P[0].budget = 'x'; d.T[0].pct = 900; d.T[1].dep = 999; d.I[0].qty = -5; d.T[2].status = 'Weird'; d.DOC = [{ n: 'old.pdf', s: 1, p: 1, c: 'Permits', d: 'x' }]; delete d.PO;
    const { db, issues } = normalizeDb(d); expect(db.P[0]!.budget).toBe(0); expect(db.T[0]!.pct).toBe(100); expect(db.T[1]!.dep).toBe(''); expect(db.I[0]!.qty).toBe(0); expect(db.T[2]!.status).toBe('To Do'); expect(db.DOC[0]!.provider).toBe('metadata-only'); expect(typeof db.DOC[0]!.id).toBe('number'); expect(db.PO).toEqual([]); expect(issues.length).toBeGreaterThanOrEqual(4);
  });
  it('backup export/import round-trips and rejects foreign files', () => { const d = freshDb(); const { db } = importBackup(exportBackup(d)); expect(db.P).toHaveLength(d.P.length); expect(() => importBackup('nope')).toThrow(/JSON/); expect(() => importBackup('{"a":1}')).toThrow(/backup/); expect(() => importBackup(JSON.stringify({ app: 'buildspace', data: { P: 1 } }))).toThrow(); });
  it('seed passes its own validation without repairs', () => expect(normalizeDb(JSON.parse(JSON.stringify(seed()))).issues).toEqual([]));
});
describe('permissions, search and notifications', () => {
  it('role matrix', () => { expect(can('Finance Officer', 'finance:write')).toBe(true); expect(can('Site Supervisor', 'finance:write')).toBe(false); expect(can('Team Member', 'task:write')).toBe(false); expect(can('Team Member', 'task:status')).toBe(true); expect(can('Project Manager', 'settings:reset')).toBe(false); expect(asRole('garbage')).toBe('Administrator'); });
  it('document visibility and deletion rules', () => { expect(canViewDocument('Site Supervisor', 'Invoices')).toBe(false); expect(canViewDocument('Site Supervisor', 'Permits')).toBe(true); expect(canDeleteDocument('Team Member', 'Tom', 'Tom')).toBe(false); expect(canDeleteDocument('Site Supervisor', 'Sam', 'Sam')).toBe(true); expect(canDeleteDocument('Site Supervisor', 'Sam', 'Other')).toBe(false); });
  it('search requires 2+ characters and finds across modules', () => { const d = freshDb(); expect(searchAll(d, 'a')).toEqual([]); expect(searchAll(d, 'cement').some((h) => h.type === 'Material')).toBe(true); expect(searchAll(d, 'riverside')[0]?.to).toBe('/projects/1'); });
  it('notifications flag overdue, blocked, low stock and overruns', () => { const n = notifications(freshDb(), TODAY_T).map((x) => x.text).join('|'); expect(n).toMatch(/Blocked task: Curtain wall/); expect(n).toMatch(/Out of stock: Gravel/); expect(n).toMatch(/Low stock: Sand/); });
});
