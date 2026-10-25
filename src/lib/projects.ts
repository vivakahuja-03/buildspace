import { PROJECT_STATUSES, type DB, type Phase, type Project, type ProjectStatus } from '../types';
import { projectProgress } from './calc';
import { isIsoDate } from './dates';
import { DomainError } from './errors';
import { nextId } from './ids';
import { isMoneyAmount } from './money';
export interface ProjectInput { name: string; mgr: string; loc: string; start: string; end: string; budget: number; reason?: string; desc?: string; client?: string }
export function saveProject(d: DB, input: ProjectInput, today: string, editingId?: number): Project {
  const old = editingId === undefined ? undefined : d.P.find((x) => x.id === editingId);
  if (editingId !== undefined && !old) throw new DomainError('Project not found');
  const name = input.name.trim().replace(/\s+/g, ' '), loc = input.loc.trim(), desc = (input.desc ?? '').trim(), client = (input.client ?? '').trim();
  if (desc.length > 1000 || client.length > 100) throw new DomainError('Description (max 1000) or client (max 100) is too long');
  if (name.length < 2 || name.length > 100) throw new DomainError('Name must be 2-100 characters');
  if (!loc || loc.length > 100) throw new DomainError('Location is required (max 100 characters)');
  const mgr = d.M.find((m) => m.name === input.mgr);
  if (!mgr || (mgr.role !== 'Project Manager' && mgr.role !== 'Administrator')) throw new DomainError('Choose a Project Manager from the team');
  if (!mgr.active && old?.mgr !== input.mgr) throw new DomainError(`${mgr.name} is inactive`);
  if (!isIsoDate(input.start) || !isIsoDate(input.end)) throw new DomainError('Enter valid start and completion dates');
  if (input.end < input.start) throw new DomainError('Completion must be on or after the start date');
  if (!isMoneyAmount(input.budget, { allowZero: true })) throw new DomainError('Budget must be 0 or more with at most 2 decimal places');
  if (d.P.some((x) => x.id !== editingId && x.name.toLowerCase() === name.toLowerCase())) throw new DomainError('A project with this name already exists');
  if (!old) { const p: Project = { id: nextId(d.P), name, mgr: input.mgr, loc, start: input.start, end: input.end, budget: input.budget, status: 'Planning', desc: desc || undefined, client: client || undefined }; d.P.push(p); return p; }
  if (old.budget !== input.budget) {
    const reason = (input.reason ?? '').trim();
    if (reason.length < 3) throw new DomainError('Give a reason for the budget revision');
    old.budgetHistory = [...(old.budgetHistory ?? []), { date: today, from: old.budget, to: input.budget, reason }].slice(-20);
  }
  if (old.name !== name) d.act = d.act.map((a) => [a[0].split(old.name).join(name), a[1]] as [string, string]);
  Object.assign(old, { name, mgr: input.mgr, loc, start: input.start, end: input.end, budget: input.budget, desc: desc || undefined, client: client || undefined });
  return old;
}
export function setProjectStatus(d: DB, id: number, to: ProjectStatus): void {
  const p = d.P.find((x) => x.id === id);
  if (!p) throw new DomainError('Project not found');
  if (!PROJECT_STATUSES.includes(to)) throw new DomainError('Invalid status');
  if (p.status === to) return;
  if (to === 'Completed') {
    const open = d.T.filter((t) => t.p === id && t.status !== 'Completed' && t.status !== 'Cancelled').length;
    if (open) throw new DomainError(`${open} task(s) are still open. Complete or cancel them before completing the project.`);
  }
  p.status = to;
}

/** Permanent deletion is only allowed for a project nothing refers to; otherwise archive it so history is kept. */
export function deleteProject(d: DB, id: number): void {
  const p = d.P.find((x) => x.id === id);
  if (!p) throw new DomainError('Project not found');
  const used = [['tasks', d.T.some((t) => t.p === id)], ['expenses', d.E.some((e) => e.p === id)], ['documents', d.DOC.some((x) => x.p === id)], ['purchase requests', d.PO.some((o) => o.p === id)], ['stock movements', d.MV.some((m) => m[4] === id)]].filter(([, v]) => v).map(([k]) => k);
  if (used.length) throw new DomainError(`This project has ${used.join(', ')}. Archive it instead so the history is kept.`);
  d.P = d.P.filter((x) => x.id !== id);
}
export interface PhaseInput { name: string; start: string; end: string }
export function savePhase(d: DB, projectId: number, input: PhaseInput, phaseId?: number): Phase {
  const p = d.P.find((x) => x.id === projectId);
  if (!p) throw new DomainError('Project not found');
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) throw new DomainError('Phase name must be 2-60 characters');
  if (!isIsoDate(input.start) || !isIsoDate(input.end)) throw new DomainError('Enter valid phase dates');
  if (input.end < input.start) throw new DomainError('Phase end must be on or after its start');
  if (input.start < p.start || input.end > p.end) throw new DomainError(`Phase dates must be inside the project (${p.start} to ${p.end})`);
  const phases = (p.phases = p.phases ?? []);
  if (phases.some((x) => x.id !== phaseId && x.name.toLowerCase() === name.toLowerCase())) throw new DomainError('A phase with this name already exists');
  const old = phaseId === undefined ? undefined : phases.find((x) => x.id === phaseId);
  if (phaseId !== undefined && !old) throw new DomainError('Phase not found');
  if (old) { Object.assign(old, { name, start: input.start, end: input.end }); return old; }
  const n: Phase = { id: nextId(phases), name, start: input.start, end: input.end }; phases.push(n); return n;
}
/** Removing a phase keeps its tasks; they simply become unphased. */
export function deletePhase(d: DB, projectId: number, phaseId: number): void {
  const p = d.P.find((x) => x.id === projectId);
  if (!p || !p.phases?.some((x) => x.id === phaseId)) throw new DomainError('Phase not found');
  p.phases = p.phases.filter((x) => x.id !== phaseId);
  d.T.forEach((t) => { if (t.p === projectId && t.phase === phaseId) t.phase = undefined; });
}
export const phaseProgress = (tasks: DB['T'], phaseId: number): number | null => projectProgress(tasks.filter((t) => t.phase === phaseId));
/** Records a supervisor note together with the progress computed from tasks at that moment. */
export function addProgressUpdate(d: DB, projectId: number, o: { note: string; by: string; today: string }): void {
  const p = d.P.find((x) => x.id === projectId);
  if (!p) throw new DomainError('Project not found');
  if (p.status === 'Archived') throw new DomainError('Archived projects cannot receive updates');
  const note = o.note.trim();
  if (note.length < 3 || note.length > 500) throw new DomainError('The note must be 3-500 characters');
  const list = (p.updates = p.updates ?? []);
  if (list.some((u) => u.date === o.today && u.note === note && u.by === o.by)) throw new DomainError('This update was already recorded today');
  list.unshift({ id: nextId(list), date: o.today, by: o.by, progress: projectProgress(d.T.filter((t) => t.p === projectId)), note });
  p.updates = list.slice(0, 200);
}
