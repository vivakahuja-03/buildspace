import { AVAILABILITY, ROLES, type Availability, type DB, type Member, type Project, type Task } from '../types';
import { isOverdue } from './calc';
import { DomainError } from './errors';
export interface MemberInput { name: string; role: string; dept: string; email?: string; phone?: string; skills?: string; availability?: Availability }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, PHONE = /^\+?[\d][\d\s()-]{6,19}$/;
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
function validate(d: DB, input: MemberInput, original?: string) {
  const name = clean(input.name), dept = clean(input.dept), email = (input.email ?? '').trim().toLowerCase(), phone = (input.phone ?? '').trim();
  if (name.length < 2 || name.length > 60) throw new DomainError('Name must be 2-60 characters');
  if (!(ROLES as readonly string[]).includes(input.role)) throw new DomainError('Choose a valid role');
  if (!dept || dept.length > 60) throw new DomainError('Department is required (max 60 characters)');
  if (email && !EMAIL.test(email)) throw new DomainError('Enter a valid email address');
  if (phone && !PHONE.test(phone)) throw new DomainError('Enter a valid phone number');
  if (d.M.some((m) => m.name !== original && m.name.toLowerCase() === name.toLowerCase())) throw new DomainError('A member with this name already exists');
  if (email && d.M.some((m) => m.name !== original && (m.email ?? '').toLowerCase() === email)) throw new DomainError('Another member already uses this email');
  const skills = [...new Set((input.skills ?? '').split(',').map((x) => clean(x)).filter(Boolean))];
  if (skills.length > 10 || skills.some((x) => x.length > 30)) throw new DomainError('Up to 10 skills, each at most 30 characters');
  const availability = input.availability ?? 'Available';
  if (!AVAILABILITY.includes(availability)) throw new DomainError('Choose a valid availability');
  return { name, role: input.role, dept, email: email || undefined, phone: phone || undefined, skills: skills.length ? skills : undefined, availability };
}
export const openTasksOf = (d: Pick<DB, 'T'>, name: string): Task[] => d.T.filter((t) => t.who === name && t.status !== 'Completed' && t.status !== 'Cancelled');
export const managedProjectsOf = (d: Pick<DB, 'P'>, name: string): Project[] => d.P.filter((p) => p.mgr === name && p.status !== 'Archived' && p.status !== 'Completed');
export function addMember(d: DB, input: MemberInput): Member { const v = validate(d, input), m: Member = { ...v, active: true }; d.M.push(m); return m; }
/** Edits a member. A rename is propagated to tasks and projects; a role change is blocked while it would orphan managed projects. */
export function updateMember(d: DB, original: string, input: MemberInput): Member {
  const m = d.M.find((x) => x.name === original);
  if (!m) throw new DomainError('Member not found');
  const v = validate(d, input, original), managed = managedProjectsOf(d, original);
  if (v.role !== 'Project Manager' && v.role !== 'Administrator' && managed.length) throw new DomainError(`${original} manages ${managed.length} project(s). Reassign them before changing the role.`);
  if (v.name !== original) { d.T.forEach((t) => { if (t.who === original) t.who = v.name; }); d.P.forEach((p) => { if (p.mgr === original) p.mgr = v.name; }); }
  Object.assign(m, v); return m;
}
/** Deactivates a member. Open work must be handed over via `reassignTo`; finished tasks keep the name for history. */
export function deactivateMember(d: DB, name: string, reassignTo?: string): void {
  const m = d.M.find((x) => x.name === name);
  if (!m) throw new DomainError('Member not found');
  if (!m.active) return;
  const tasks = openTasksOf(d, name), projects = managedProjectsOf(d, name);
  if ((tasks.length || projects.length) && !reassignTo) throw new DomainError(`${name} has ${tasks.length} open task(s) and manages ${projects.length} project(s). Choose someone to take them over.`);
  if (reassignTo) {
    const to = d.M.find((x) => x.name === reassignTo);
    if (!to || !to.active || to.name === name) throw new DomainError('Choose a different active member to take over');
    if (projects.length && to.role !== 'Project Manager' && to.role !== 'Administrator') throw new DomainError(`${to.name} cannot manage projects (role: ${to.role})`);
    tasks.forEach((t) => { t.who = to.name; }); projects.forEach((p) => { p.mgr = to.name; });
  }
  if ((m.role === 'Project Manager' || m.role === 'Administrator') && !d.M.some((x) => x !== m && x.active && (x.role === 'Project Manager' || x.role === 'Administrator')) && d.P.some((p) => p.status !== 'Archived'))
    throw new DomainError('At least one active Project Manager or Administrator is required');
  m.active = false;
}
export function activateMember(d: DB, name: string): void { const m = d.M.find((x) => x.name === name); if (!m) throw new DomainError('Member not found'); m.active = true; }

/** Open/overdue work per person, for workload and availability summaries. */
export function workload(d: Pick<DB, 'T' | 'M'>, today: string) {
  return d.M.map((m) => { const open = openTasksOf(d, m.name); return { name: m.name, role: m.role, active: m.active, availability: m.availability ?? 'Available', open: open.length, overdue: open.filter((t) => isOverdue(t, today)).length }; });
}
