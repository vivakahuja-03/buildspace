import { PRIORITIES, TASK_STATUSES, type DB, type Priority, type Task, type TaskStatus } from '../types';
import { clampPct, wouldCycle } from './calc';
import { diffDays, isIsoDate } from './dates';
import { DomainError } from './errors';
import { nextId } from './ids';
/** Returns an error message when the dependency is invalid, otherwise null. Finish-to-start, same project. */
export function dependencyError(tasks: Task[], dep: number | '', start: string, selfId?: number, projectId?: number): string | null {
  if (dep === '') return null;
  const d = tasks.find((t) => t.id === dep);
  if (!d) return 'Dependency not found';
  if (projectId !== undefined && d.p !== projectId) return 'A task can only depend on a task in the same project';
  if (selfId !== undefined && wouldCycle(tasks, selfId, dep)) return 'This would create a circular dependency';
  if (start < d.due) return `Must start on or after "${d.title}" ends (${d.due})`;
  return null;
}
/** Allowed manual status moves. Finished work must be reopened deliberately; cancelled work can only be restored to the backlog. */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  if (from === 'Cancelled') return to === 'Backlog' || to === 'To Do';
  if (from === 'Completed') return to === 'In Progress' || to === 'To Do';
  return true;
}
/** Finish-to-start: a task cannot be started or completed while its predecessor is unfinished (cancelled predecessors do not block). */
export function predecessorBlock(tasks: Task[], t: Pick<Task, 'dep'>, to: TaskStatus): string | null {
  if (to !== 'In Progress' && to !== 'Completed') return null;
  const pre = t.dep === '' ? undefined : tasks.find((x) => x.id === t.dep);
  return pre && pre.status !== 'Completed' && pre.status !== 'Cancelled' ? `Finish "${pre.title}" first (it is ${pre.status})` : null;
}
export function setTaskStatus(d: DB, id: number, to: TaskStatus): void {
  const t = d.T.find((x) => x.id === id);
  if (!t) throw new DomainError('Task not found');
  if (!TASK_STATUSES.includes(to)) throw new DomainError('Invalid status');
  if (t.status === to) return;
  if (!canTransition(t.status, to)) throw new DomainError(t.status === 'Cancelled' ? 'A cancelled task can only be restored to Backlog or To Do' : 'A completed task can only be reopened to To Do or In Progress');
  const block = predecessorBlock(d.T, t, to);
  if (block) throw new DomainError(block);
  if (to === 'Completed') t.pct = 100;
  else if (t.status === 'Completed') t.pct = Math.min(t.pct, 99);
  t.status = to;
}
export interface TaskInput { title: string; p: number; who: string; start: string; due: string; pct: number; dep: number | ''; pri?: Priority; desc?: string; ms?: boolean; phase?: number | '' }
export function saveTask(d: DB, input: TaskInput, editingId?: number): Task {
  const old = editingId === undefined ? undefined : d.T.find((x) => x.id === editingId);
  if (editingId !== undefined && !old) throw new DomainError('Task not found');
  const proj = d.P.find((x) => x.id === input.p);
  if (!proj) throw new DomainError('Choose a valid project');
  if (proj.status === 'Archived' && (!old || old.p !== input.p)) throw new DomainError('Cannot add tasks to an archived project');
  const title = input.title.trim().replace(/\s+/g, ' ');
  if (title.length < 2 || title.length > 120) throw new DomainError('Title must be 2-120 characters');
  const member = d.M.find((m) => m.name === input.who);
  if (!member) throw new DomainError('Choose a valid assignee');
  if (!member.active && old?.who !== input.who) throw new DomainError(`${member.name} is inactive and cannot be assigned new work`);
  if (member.availability === 'Unavailable' && old?.who !== input.who) throw new DomainError(`${member.name} is marked Unavailable and cannot receive new assignments`);
  const desc = (input.desc ?? '').trim();
  if (desc.length > 1000) throw new DomainError('Description is too long (max 1000 characters)');
  const phase = input.phase === '' || input.phase === undefined ? undefined : input.phase;
  if (phase !== undefined && !proj.phases?.some((x) => x.id === phase)) throw new DomainError('Choose a phase of this project');
  if (!isIsoDate(input.start) || !isIsoDate(input.due)) throw new DomainError('Enter valid start and due dates');
  if (input.due < input.start) throw new DomainError('Due date must be on or after the start date');
  if (!Number.isInteger(input.pct) || input.pct < 0 || input.pct > 100) throw new DomainError('Completion must be a whole number from 0 to 100');
  if (input.pri !== undefined && !PRIORITIES.includes(input.pri)) throw new DomainError('Invalid priority');
  if (d.T.some((x) => x.id !== editingId && x.p === input.p && x.title.toLowerCase() === title.toLowerCase())) throw new DomainError('A task with this title already exists in the project');
  const e = dependencyError(d.T, input.dep, input.start, editingId, input.p);
  if (e) throw new DomainError(e);
  if (old && old.p !== input.p && d.T.some((x) => x.dep === old.id)) throw new DomainError('Other tasks depend on this one; move or unlink them before changing its project');
  let status: TaskStatus = old?.status ?? 'To Do';
  if (status !== 'Cancelled') { if (input.pct >= 100) status = 'Completed'; else if (status === 'Completed') status = 'In Progress'; }
  const pre = predecessorBlock(d.T, { dep: input.dep }, status === 'Completed' ? 'Completed' : 'To Do');
  if (pre) throw new DomainError(pre);
  const rec = { title, p: input.p, who: input.who, start: input.start, due: input.due, pct: clampPct(input.pct), dep: input.dep, pri: input.pri ?? old?.pri ?? 'Medium', status, desc: desc || undefined, phase, ms: input.ms ?? old?.ms ?? false };
  if (old) { Object.assign(old, rec); return old; }
  const n: Task = { id: nextId(d.T), ...rec }; d.T.push(n); return n;
}
export function deleteTask(d: DB, id: number): void {
  if (!d.T.some((x) => x.id === id)) throw new DomainError('Task not found');
  d.T = d.T.filter((x) => x.id !== id);
  d.T.forEach((x) => { if (x.dep === id) x.dep = ''; });
}
export interface TaskFilter { project?: number | ''; status?: TaskStatus | ''; who?: string; pri?: Priority | ''; q?: string; overdueOnly?: boolean }
export function filterTasks(tasks: Task[], f: TaskFilter, today: string): Task[] {
  const q = (f.q ?? '').trim().toLowerCase();
  return tasks.filter((t) => (!f.project || t.p === f.project) && (!f.status || t.status === f.status) && (!f.who || t.who === f.who) && (!f.pri || (t.pri ?? 'Medium') === f.pri)
    && (!q || t.title.toLowerCase().includes(q)) && (!f.overdueOnly || (t.status !== 'Completed' && t.status !== 'Cancelled' && t.due < today)));
}
export { diffDays };

export type SortKey = 'due' | 'start' | 'priority' | 'title' | 'status';
const PRI_RANK: Record<Priority, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
export function sortTasks(tasks: Task[], key: SortKey, dir: 'asc' | 'desc' = 'asc'): Task[] {
  const f = dir === 'asc' ? 1 : -1, v = (t: Task) => (key === 'priority' ? PRI_RANK[t.pri ?? 'Medium'] : key === 'status' ? TASK_STATUSES.indexOf(t.status) : key === 'title' ? t.title.toLowerCase() : t[key]);
  return [...tasks].sort((a, b) => { const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : a.id - b.id) * f; });
}
