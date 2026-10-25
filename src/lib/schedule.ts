import type { DB, Project, Task } from '../types';
import { addDays, diffDays, fromDay, isIsoDate, toDay } from './dates';
import { duration } from './calc';
import { DomainError } from './errors';
export interface Conflict { task: number; kind: 'dependency' | 'assignee' | 'outside-project' | 'invalid-dates'; severity: 'error' | 'warning'; message: string; other?: number }
const live = (t: Task) => t.status !== 'Cancelled';
/** Scheduling problems across the given tasks. Dependency/date problems are errors; resource and window problems are warnings. */
export function scheduleConflicts(tasks: Task[], projects: Pick<Project, 'id' | 'start' | 'end' | 'name'>[]): Conflict[] {
  const out: Conflict[] = [], open = tasks.filter(live);
  for (const t of open) {
    if (!isIsoDate(t.start) || !isIsoDate(t.due) || t.due < t.start) { out.push({ task: t.id, kind: 'invalid-dates', severity: 'error', message: 'Invalid or reversed dates' }); continue; }
    const pre = t.dep === '' ? undefined : tasks.find((x) => x.id === t.dep);
    if (pre && live(pre) && t.start < pre.due) out.push({ task: t.id, kind: 'dependency', severity: 'error', message: `Starts before "${pre.title}" ends (${pre.due})`, other: pre.id });
    const p = projects.find((x) => x.id === t.p);
    if (p && (t.start < p.start || t.due > p.end)) out.push({ task: t.id, kind: 'outside-project', severity: 'warning', message: `Outside the project window (${p.start} to ${p.end})` });
  }
  const active = open.filter((t) => t.status !== 'Completed' && isIsoDate(t.start) && isIsoDate(t.due));
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i], b = active[j];
    if (a && b && a.who === b.who && a.start <= b.due && b.start <= a.due) {
      out.push({ task: a.id, kind: 'assignee', severity: 'warning', message: `${a.who} is also on "${b.title}" at the same time`, other: b.id });
      out.push({ task: b.id, kind: 'assignee', severity: 'warning', message: `${b.who} is also on "${a.title}" at the same time`, other: a.id });
    }
  }
  return out;
}
export interface DateChange { id: number; start: string; due: string }
/** Computes the date changes needed to move a task (and, with `cascade`, push dependants forward keeping their length). Pure; throws DomainError. */
export function planReschedule(tasks: Task[], id: number, start: string, due: string, cascade: boolean): DateChange[] {
  const t = tasks.find((x) => x.id === id);
  if (!t) throw new DomainError('Task not found');
  if (t.status === 'Completed') throw new DomainError('Completed tasks keep their dates. Reopen the task to change them.');
  if (!isIsoDate(start) || !isIsoDate(due)) throw new DomainError('Enter valid dates');
  if (due < start) throw new DomainError('Due date must be on or after the start date');
  const pre = t.dep === '' ? undefined : tasks.find((x) => x.id === t.dep);
  if (pre && live(pre) && start < pre.due) throw new DomainError(`Cannot start before "${pre.title}" ends (${pre.due})`);
  const changes = new Map<number, DateChange>([[id, { id, start, due }]]);
  const queue = [id];
  while (queue.length) {
    const cur = changes.get(queue.shift() as number) as DateChange;
    for (const s of tasks.filter((x) => x.dep === cur.id && live(x))) {
      if (s.start >= cur.due) continue;
      if (!cascade) throw new DomainError(`"${s.title}" starts ${s.start}, before this task would end. Enable "shift dependent tasks" or move it first.`);
      if (s.status === 'Completed') throw new DomainError(`Completed task "${s.title}" would be affected`);
      const shift = diffDays(s.start, cur.due);
      changes.set(s.id, { id: s.id, start: addDays(s.start, shift), due: addDays(s.due, shift) }); queue.push(s.id);
    }
  }
  return [...changes.values()];
}
export function rescheduleTask(d: DB, id: number, start: string, due: string, cascade: boolean): DateChange[] {
  const changes = planReschedule(d.T, id, start, due, cascade);
  for (const c of changes) { const t = d.T.find((x) => x.id === c.id); if (t) { t.start = c.start; t.due = c.due; } }
  return changes;
}
export interface Timeline { lo: string; hi: string; days: number; px: number; width: number; x: (date: string) => number; bar: (t: Pick<Task, 'start' | 'due'>) => { left: number; width: number }; months: { label: string; x: number; w: number }[]; ticks: { label: string; x: number }[] }
export function buildTimeline(tasks: Pick<Task, 'start' | 'due'>[], today: string, px: number): Timeline {
  const valid = tasks.filter((t) => isIsoDate(t.start) && isIsoDate(t.due));
  const lo0 = valid.reduce((m, t) => (t.start < m ? t.start : m), today), hi0 = valid.reduce((m, t) => (t.due > m ? t.due : m), today);
  const lo = addDays(lo0, -3), hi = addDays(hi0, 7), days = diffDays(lo, hi) + 1;
  const x = (date: string) => diffDays(lo, date) * px;
  const months: Timeline['months'] = [];
  for (let d = toDay(lo); d <= toDay(hi); d++) {
    const iso = fromDay(d), label = new Date(`${iso}T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }), last = months[months.length - 1];
    if (last && last.label === label) last.w += px; else months.push({ label, x: (d - toDay(lo)) * px, w: px });
  }
  const ticks: Timeline['ticks'] = [];
  for (let d = toDay(lo); d <= toDay(hi); d++) {
    const iso = fromDay(d), dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
    if (px >= 20) ticks.push({ label: iso.slice(8), x: (d - toDay(lo)) * px }); else if (px >= 8 && dow === 1) ticks.push({ label: iso.slice(5), x: (d - toDay(lo)) * px });
  }
  return { lo, hi, days, px, width: days * px, x, bar: (t) => ({ left: x(t.start), width: duration(t.start, t.due) * px }), months, ticks };
}
