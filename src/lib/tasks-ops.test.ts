import { describe, expect, it } from 'vitest';
import { canTransition, deleteTask, filterTasks, saveTask, setTaskStatus } from './tasks';
import { planReschedule, rescheduleTask, scheduleConflicts, buildTimeline } from './schedule';
import { freshDb, TODAY_T } from './fixtures';
import { projectProgress } from './calc';
const input = { title: 'New work item', p: 1, who: 'Imran Ali', start: '2027-02-21', due: '2027-03-01', pct: 0, dep: '' as const };
describe('task CRUD and validation', () => {
  it('creates, edits and deletes a task', () => { const d = freshDb(), n = d.T.length, t = saveTask(d, input); expect(d.T).toHaveLength(n + 1); expect(t.status).toBe('To Do'); expect(t.pri).toBe('Medium'); saveTask(d, { ...input, title: 'Renamed item', pct: 20, pri: 'High' }, t.id); expect(d.T.find((x) => x.id === t.id)?.pri).toBe('High'); deleteTask(d, t.id); expect(d.T).toHaveLength(n); });
  it('validates required fields and relationships', () => {
    const d = freshDb(), n = d.T.length;
    for (const bad of [{ title: ' ' }, { p: 99 }, { who: 'Nobody' }, { start: 'x' }, { due: '2027-01-01' }, { pct: 101 }, { pct: 1.5 }, { pri: 'Urgent' as never }]) expect(() => saveTask(d, { ...input, ...bad })).toThrow();
    expect(d.T).toHaveLength(n);
  });
  it('rejects duplicate titles in a project and inactive assignees', () => { const d = freshDb(); saveTask(d, input); expect(() => saveTask(d, input)).toThrow(/already exists/); expect(() => saveTask(d, { ...input, title: 'Another one', who: 'Nida Rauf' })).toThrow(/inactive/); });
  it('enforces dependency rules: same project, no cycles, finish-to-start', () => {
    const d = freshDb();
    expect(() => saveTask(d, { ...input, dep: 5 })).toThrow(/same project/);
    expect(() => saveTask(d, { ...input, title: 'Early start', start: '2026-12-01', dep: 4 })).toThrow(/Must start on or after/);
    expect(() => saveTask(d, { title: 'Structural frame, blocks A-C', p: 1, who: 'Zara Malik', start: '2026-05-16', due: '2026-12-30', pct: 55, dep: 4 }, 3)).toThrow(/circular/);
  });
  it('a completed percentage completes the task, and lowering it reopens it', () => { const d = freshDb(), t = saveTask(d, { ...input, pct: 100 }); expect(t.status).toBe('Completed'); saveTask(d, { ...input, pct: 40 }, t.id); expect(t.status).toBe('In Progress'); });
  it('cannot complete a task whose predecessor is unfinished', () => { const d = freshDb(); expect(() => setTaskStatus(d, 4, 'Completed')).toThrow(/Finish/); expect(() => setTaskStatus(d, 4, 'In Progress')).toThrow(/Finish/); });
  it('status transitions are consistent', () => {
    const d = freshDb(); expect(canTransition('Completed', 'Backlog')).toBe(false); expect(canTransition('Cancelled', 'Completed')).toBe(false); expect(canTransition('Cancelled', 'To Do')).toBe(true);
    setTaskStatus(d, 3, 'Completed'); expect(d.T.find((x) => x.id === 3)?.pct).toBe(100);
    expect(() => setTaskStatus(d, 3, 'Backlog')).toThrow(); setTaskStatus(d, 3, 'In Progress'); expect(d.T.find((x) => x.id === 3)?.pct).toBe(99);
    setTaskStatus(d, 10, 'Cancelled'); expect(() => setTaskStatus(d, 10, 'Completed')).toThrow();
  });
  it('task changes update project progress', () => { const d = freshDb(), before = projectProgress(d.T.filter((t) => t.p === 3)); setTaskStatus(d, 10, 'Cancelled'); const after = projectProgress(d.T.filter((t) => t.p === 3)); expect(after).not.toBe(before); expect(after!).toBeGreaterThanOrEqual(0); });
  it('deleting a task unlinks its dependants', () => { const d = freshDb(); deleteTask(d, 2); expect(d.T.find((x) => x.id === 3)?.dep).toBe(''); });
  it('filters by project, status, assignee, priority, text and overdue', () => { const d = freshDb(); expect(filterTasks(d.T, { project: 1 }, TODAY_T).every((t) => t.p === 1)).toBe(true); expect(filterTasks(d.T, { status: 'Blocked' }, TODAY_T)).toHaveLength(1); expect(filterTasks(d.T, { q: 'masonry' }, TODAY_T)).toHaveLength(1); expect(filterTasks(d.T, { overdueOnly: true }, TODAY_T).every((t) => t.due < TODAY_T && t.status !== 'Completed')).toBe(true); });
});
describe('timeline and scheduling', () => {
  it('detects dependency, window and assignee conflicts, ignoring cancelled tasks', () => {
    const d = freshDb(); d.T.find((x) => x.id === 4)!.start = '2026-12-01';
    const c = scheduleConflicts(d.T, d.P); expect(c.some((x) => x.task === 4 && x.kind === 'dependency' && x.severity === 'error')).toBe(true); expect(c.some((x) => x.kind === 'assignee')).toBe(true);
    d.T.find((x) => x.id === 4)!.status = 'Cancelled'; expect(scheduleConflicts(d.T, d.P).some((x) => x.task === 4)).toBe(false);
  });
  it('rejects invalid reschedules', () => { const d = freshDb(); expect(() => planReschedule(d.T, 4, '2027-02-01', '2027-01-01', false)).toThrow(/on or after/); expect(() => planReschedule(d.T, 4, '2026-12-01', '2027-02-01', false)).toThrow(/Cannot start before/); expect(() => planReschedule(d.T, 1, '2026-02-01', '2026-03-01', false)).toThrow(/Completed/); expect(() => planReschedule(d.T, 4, 'nope', '2027-02-01', false)).toThrow(); });
  it('blocks, or cascades to, dependent tasks', () => {
    const d = freshDb(); expect(() => planReschedule(d.T, 3, '2026-05-16', '2027-03-15', false)).toThrow(/"Electrical/);
    const ch = rescheduleTask(d, 3, '2026-05-16', '2027-03-15', true); expect(ch.map((c) => c.id)).toEqual([3, 4]);
    const t4 = d.T.find((x) => x.id === 4)!; expect(t4.start).toBe('2027-03-15'); expect(t4.due).toBe('2027-05-03');
  });
  it('timeline geometry is consistent', () => { const tl = buildTimeline([{ start: '2026-01-10', due: '2026-01-19' }], '2026-01-12', 10); expect(tl.lo).toBe('2026-01-07'); expect(tl.x('2026-01-10')).toBe(30); expect(tl.bar({ start: '2026-01-10', due: '2026-01-19' })).toEqual({ left: 30, width: 100 }); expect(tl.width).toBe(tl.days * 10); expect(tl.months.reduce((s, m) => s + m.w, 0)).toBe(tl.width); });
  it('timeline copes with no tasks', () => { const tl = buildTimeline([], '2026-05-05', 8); expect(tl.days).toBe(11); });
});
