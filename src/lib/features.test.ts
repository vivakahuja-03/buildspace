import { describe, expect, it } from 'vitest';
import { addProgressUpdate, deletePhase, deleteProject, phaseProgress, savePhase, saveProject } from './projects';
import { saveTask, sortTasks } from './tasks';
import { addMember, updateMember, workload } from './team';
import { advancePurchaseOrder, createPurchaseRequest, openPurchaseValue } from './inventory';
import { dashboardMetrics } from './metrics';
import { buildReport, defaultFilter } from './reports';
import { previewKind } from './documents';
import { can } from './permissions';
import { freshDb, TODAY_T } from './fixtures';
const task = { title: 'Phase task', p: 1, who: 'Imran Ali', start: '2027-02-21', due: '2027-03-01', pct: 0, dep: '' as const };
describe('project lifecycle', () => {
  it('stores description and client and validates their length', () => {
    const d = freshDb(), p = { name: 'Bridge Repair', mgr: 'Ayesha Khan', loc: 'Sukkur', start: '2026-11-01', end: '2027-05-01', budget: 100 };
    const n = saveProject(d, { ...p, desc: 'Deck replacement', client: 'City Council' }, TODAY_T); expect([n.desc, n.client]).toEqual(['Deck replacement', 'City Council']);
    expect(() => saveProject(d, { ...p, name: 'Other', desc: 'x'.repeat(1001) }, TODAY_T)).toThrow(/too long/);
  });
  it('deletes only unreferenced projects; otherwise asks to archive', () => {
    const d = freshDb(); expect(() => deleteProject(d, 1)).toThrow(/Archive it instead/);
    const n = saveProject(d, { name: 'Empty One', mgr: 'Ayesha Khan', loc: 'X', start: '2026-11-01', end: '2027-01-01', budget: 0 }, TODAY_T); deleteProject(d, n.id); expect(d.P.some((x) => x.id === n.id)).toBe(false); expect(() => deleteProject(d, 999)).toThrow(/not found/);
  });
  it('phases: validated, unique, inside the project window, deletable without losing tasks', () => {
    const d = freshDb(), ph = savePhase(d, 1, { name: 'Foundations', start: '2026-03-01', end: '2026-06-30' });
    expect(() => savePhase(d, 1, { name: 'foundations', start: '2026-03-01', end: '2026-06-30' })).toThrow(/already exists/);
    expect(() => savePhase(d, 1, { name: 'Too early', start: '2000-01-01', end: '2026-06-30' })).toThrow(/inside the project/); expect(() => savePhase(d, 1, { name: 'Backwards', start: '2026-06-30', end: '2026-03-01' })).toThrow();
    const t = saveTask(d, { ...task, phase: ph.id }); expect(t.phase).toBe(ph.id); expect(() => saveTask(d, { ...task, title: 'Bad phase', phase: 99 })).toThrow(/phase/);
    expect(phaseProgress(d.T, ph.id)).toBe(0); deletePhase(d, 1, ph.id); expect(d.T.find((x) => x.id === t.id)?.phase).toBeUndefined(); expect(d.T.some((x) => x.id === t.id)).toBe(true);
  });
  it('milestones are tasks flagged ms', () => { const d = freshDb(), t = saveTask(d, { ...task, ms: true }); expect(t.ms).toBe(true); });
  it('progress history records computed progress with the note, once per identical note per day', () => {
    const d = freshDb(); addProgressUpdate(d, 1, { note: 'Slab poured on level 2', by: 'Sam', today: TODAY_T });
    const u = d.P[0]!.updates![0]!; expect([u.note, u.by, u.date, typeof u.progress]).toEqual(['Slab poured on level 2', 'Sam', TODAY_T, 'number']);
    expect(() => addProgressUpdate(d, 1, { note: 'Slab poured on level 2', by: 'Sam', today: TODAY_T })).toThrow(/already/); expect(() => addProgressUpdate(d, 1, { note: 'hi', by: 'Sam', today: TODAY_T })).toThrow(/3-500/);
    d.P[0]!.status = 'Archived'; expect(() => addProgressUpdate(d, 1, { note: 'late note', by: 'Sam', today: TODAY_T })).toThrow(/Archived/);
  });
});
describe('tasks: details and sorting', () => {
  it('keeps description; sorts by due date, priority, title and status', () => {
    const d = freshDb(), a = saveTask(d, { ...task, title: 'Zeta', desc: 'details', pri: 'Critical', due: '2027-03-05' }), b = saveTask(d, { ...task, title: 'Alpha', pri: 'Low', due: '2027-03-02' });
    expect(a.desc).toBe('details'); expect(() => saveTask(d, { ...task, title: 'Long', desc: 'x'.repeat(1001) })).toThrow();
    const only = d.T.filter((t) => t.id === a.id || t.id === b.id);
    expect(sortTasks(only, 'due').map((t) => t.title)).toEqual(['Alpha', 'Zeta']); expect(sortTasks(only, 'priority').map((t) => t.title)).toEqual(['Zeta', 'Alpha']); expect(sortTasks(only, 'title', 'desc').map((t) => t.title)).toEqual(['Zeta', 'Alpha']);
  });
});
describe('workers: skills, availability, workload', () => {
  it('stores skills (deduplicated, limited) and availability', () => {
    const d = freshDb(), m = addMember(d, { name: 'Omar Raza', role: 'Team Member', dept: 'Civil', skills: 'Welding, Rebar, welding', availability: 'Partially available' });
    expect(m.skills).toEqual(['Welding', 'Rebar', 'welding']); expect(m.availability).toBe('Partially available');
    expect(() => addMember(d, { name: 'Too Many', role: 'Team Member', dept: 'x', skills: Array.from({ length: 11 }, (_, i) => `s${i}`).join(',') })).toThrow(/10 skills/); expect(() => updateMember(d, 'Omar Raza', { name: 'Omar Raza', role: 'Team Member', dept: 'Civil', availability: 'Nope' as never })).toThrow(/availability/);
  });
  it('an Unavailable member cannot receive new tasks but keeps existing ones', () => {
    const d = freshDb(); d.M.find((m) => m.name === 'Imran Ali')!.availability = 'Unavailable'; expect(() => saveTask(d, task)).toThrow(/Unavailable/);
    const existing = d.T.find((t) => t.who === 'Imran Ali')!; expect(() => saveTask(d, { title: existing.title, p: existing.p, who: existing.who, start: existing.start, due: existing.due, pct: existing.pct, dep: existing.dep }, existing.id)).not.toThrow();
  });
  it('workload counts open and overdue tasks per person', () => { const d = freshDb(), w = workload(d, TODAY_T), z = w.find((x) => x.name === 'Zara Malik')!; expect(z.open).toBeGreaterThan(0); expect(z.overdue).toBeLessThanOrEqual(z.open); });
});
describe('purchase requests: projects, approval, obligations', () => {
  it('links a project and requires a manager role to approve', () => {
    const d = freshDb(); createPurchaseRequest(d, { m: 1, q: 10, today: TODAY_T, p: 1, by: 'Sam' }); expect(d.PO[0]!.p).toBe(1);
    expect(() => advancePurchaseOrder(d, d.PO[0]!.id, TODAY_T, { role: 'Site Supervisor' })).toThrow(/approve/); expect(d.PO[0]!.status).toBe('Requested');
    advancePurchaseOrder(d, d.PO[0]!.id, TODAY_T, { role: 'Project Manager', by: 'Pat' }); expect([d.PO[0]!.status, d.PO[0]!.approvedBy]).toEqual(['Approved', 'Pat']);
    expect(() => createPurchaseRequest(d, { m: 1, q: 1, today: TODAY_T, p: 999 })).toThrow(/project/);
  });
  it('open obligations are reported separately and never double count with expenses', () => {
    const d = freshDb(); createPurchaseRequest(d, { m: 1, q: 10, today: TODAY_T, p: 1 }); expect(openPurchaseValue(d, 1)).toBe(0); advancePurchaseOrder(d, d.PO[0]!.id, TODAY_T); expect(openPurchaseValue(d, 1)).toBe(10 * d.I[0]!.cost);
    advancePurchaseOrder(d, d.PO[0]!.id, TODAY_T); advancePurchaseOrder(d, d.PO[0]!.id, TODAY_T); expect(openPurchaseValue(d, 1)).toBe(0);
    const r = buildReport(d, defaultFilter(), TODAY_T)!; expect(r.purchases.rows).toHaveLength(1); expect(r.purchases.byStatus.find((s) => s.status === 'Received')?.count).toBe(1);
  });
  it('approval permission exists only for managers', () => { expect(can('Project Manager', 'purchase:approve')).toBe(true); expect(can('Procurement Officer', 'purchase:approve')).toBe(false); expect(can('Project Manager', 'project:delete')).toBe(false); expect(can('Administrator', 'project:delete')).toBe(true); });
});
describe('dashboard filters and documents', () => {
  it('filters by project and deadline horizon; unfiltered totals unchanged', () => {
    const d = freshDb(), all = dashboardMetrics(d, TODAY_T), one = dashboardMetrics(d, TODAY_T, { project: 2 });
    expect(one.projects.map((p) => p.id)).toEqual([2]); expect(one.overdue.every((t) => t.p === 2)).toBe(true); expect(one.budget.allocated).toBe(d.P.find((p) => p.id === 2)!.budget); expect(all.total).toBe(5);
    expect(dashboardMetrics(d, TODAY_T, { horizonDays: 0 }).upcoming.every((t) => t.due === TODAY_T)).toBe(true); expect(dashboardMetrics(d, TODAY_T, { horizonDays: 365 }).upcoming.length).toBeGreaterThanOrEqual(all.upcoming.length);
    expect(all.delayed.every((p) => all.projects.includes(p))).toBe(true);
  });
  it('previews only images and plain text', () => { expect(previewKind('image/png', 'a.png')).toBe('image'); expect(previewKind('text/plain', 'a.txt')).toBe('text'); expect(previewKind('application/pdf', 'a.pdf')).toBeNull(); expect(previewKind('text/html', 'a.html')).toBeNull(); expect(previewKind('image/svg+xml', 'a.svg')).toBeNull(); expect(previewKind('text/plain', 'a.png')).toBeNull(); });
});
