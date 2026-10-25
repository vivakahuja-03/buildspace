import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../components/ui/button';
import { Badge, Card } from '../components/ui/card';
import { Field, FormActions, FormError } from '../components/ui/field';
import { Modal } from '../components/ui/modal';
import { Table } from '../components/ui/table';
import { Empty, Notice } from '../components/ui/states';
import { useData } from '../data/store';
import { activateMember, addMember, deactivateMember, managedProjectsOf, openTasksOf, updateMember, workload } from '../lib/team';
import { fieldCls, inlineField } from '../lib/utils';
import { AVAILABILITY, ROLES, type Member } from '../types';
const schema = z.object({ name: z.string().min(2, 'Name is required'), role: z.enum(ROLES), dept: z.string().min(1, 'Department is required'), email: z.string().optional(), phone: z.string().optional(), skills: z.string().optional(), availability: z.enum(AVAILABILITY) });
type Form = z.infer<typeof schema>;
function MemberForm({ editing, onDone }: { editing: Member | null; onDone: () => void }) {
  const { update } = useData(), [err, setErr] = useState('');
  const { register, handleSubmit, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: editing ? { name: editing.name, role: editing.role as Form['role'], dept: editing.dept, email: editing.email ?? '', phone: editing.phone ?? '', skills: (editing.skills ?? []).join(', '), availability: editing.availability ?? 'Available' } : { role: 'Team Member', name: '', dept: '', email: '', phone: '', skills: '', availability: 'Available' } });
  const submit = handleSubmit((v) => { const r = update((d) => { if (editing) updateMember(d, editing.name, v); else addMember(d, v); }, `Team member ${editing ? 'updated' : 'added'}: ${v.name}`, 'team:write'); if (r.ok) onDone(); else setErr(r.error); });
  return <form onSubmit={submit} className="space-y-2" noValidate><FormError m={err} />
    <Field label="Name" error={errors.name?.message}><input className={fieldCls} {...register('name')} /></Field>
    <Field label="Role" error={errors.role?.message}><select className={fieldCls} {...register('role')}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
    <Field label="Department" error={errors.dept?.message}><input className={fieldCls} {...register('dept')} /></Field>
    <Field label="Skills (comma separated, optional)" error={errors.skills?.message}><input className={fieldCls} {...register('skills')} /></Field>
    <Field label="Availability" error={errors.availability?.message}><select className={fieldCls} {...register('availability')}>{AVAILABILITY.map((a) => <option key={a}>{a}</option>)}</select></Field>
    <Field label="Email (optional)" error={errors.email?.message}><input type="email" className={fieldCls} {...register('email')} /></Field>
    <Field label="Phone (optional)" error={errors.phone?.message}><input type="tel" className={fieldCls} {...register('phone')} /></Field>
    <FormActions onCancel={onDone} /></form>;
}
function Deactivate({ m, onDone }: { m: Member; onDone: () => void }) {
  const { db, update } = useData(), [to, setTo] = useState(''), [err, setErr] = useState('');
  const tasks = openTasksOf(db, m.name), projects = managedProjectsOf(db, m.name), needs = tasks.length > 0 || projects.length > 0;
  const choices = db.M.filter((x) => x.active && x.name !== m.name && (!projects.length || x.role === 'Project Manager' || x.role === 'Administrator'));
  const go = () => { const r = update((d) => deactivateMember(d, m.name, to || undefined), `${m.name} deactivated${to ? `; work reassigned to ${to}` : ''}`, 'team:write'); if (r.ok) onDone(); else setErr(r.error); };
  return <div className="space-y-2 text-sm"><FormError m={err} />
    <p>{needs ? `${m.name} has ${tasks.length} open task(s) and manages ${projects.length} project(s). They must be handed over before deactivating. Completed work keeps ${m.name}'s name for history.` : `Deactivate ${m.name}? They will no longer be assignable. Their history is kept.`}</p>
    {needs && <label className="block">Hand over to<select className={fieldCls} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{choices.map((x) => <option key={x.name}>{x.name}</option>)}</select></label>}
    <div className="flex gap-2"><Button variant="danger" disabled={needs && !to} onClick={go}>Deactivate</Button><Button onClick={onDone}>Cancel</Button></div></div>;
}
export default function Team() {
  const { db, today, can, update } = useData(), w = can('team:write');
  const [dlg, setDlg] = useState<{ t: 'form'; m: Member | null } | { t: 'off'; m: Member } | null>(null), [q, setQ] = useState(''), [role, setRole] = useState(''), [st, setSt] = useState(''), [err, setErr] = useState('');
  const rows = db.M.filter((m) => (!q || `${m.name} ${m.role} ${m.dept} ${m.email ?? ''}`.toLowerCase().includes(q.toLowerCase())) && (!role || m.role === role) && (!st || (st === 'active') === m.active));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Team</h1>
        <input type="search" aria-label="Search team" placeholder="Search team" value={q} onChange={(e) => setQ(e.target.value)} className={inlineField} />
        <select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)} className={inlineField}><option value="">All roles</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
        <select aria-label="Filter by status" value={st} onChange={(e) => setSt(e.target.value)} className={inlineField}><option value="">Active & inactive</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <Button variant="primary" disabled={!w} onClick={() => setDlg({ t: 'form', m: null })}>+ Add member</Button></div>
      {err && <Notice tone="error" onClose={() => setErr('')}>{err}</Notice>}
      {!db.M.length ? <Empty title="No team members yet" /> : <Card><Table head={['Name', 'Role', 'Department', 'Skills', 'Availability', 'Open / overdue', 'Status', '']} empty="No team members match." rows={rows.map((m) => [m.name, m.role, m.dept, (m.skills ?? []).join(', ') || '—', m.availability ?? 'Available', `${openTasksOf(db, m.name).length} / ${workload(db, today).find((x) => x.name === m.name)?.overdue ?? 0}`, m.active ? <Badge key="s" tone="ok">Active</Badge> : <Badge key="s">Inactive</Badge>,
        <span key="a" className="flex gap-1"><Button disabled={!w} onClick={() => setDlg({ t: 'form', m })}>Edit</Button>{m.active ? <Button disabled={!w} onClick={() => setDlg({ t: 'off', m })}>Deactivate</Button> : <Button disabled={!w} onClick={() => { const r = update((d) => activateMember(d, m.name), `${m.name} activated`, 'team:write'); setErr(r.ok ? '' : r.error); }}>Activate</Button>}</span>])} /></Card>}
      <p className="text-xs text-slate-500">Roles control what each person may change in this browser-only demo (set the demo role in Settings). They are not a security boundary until the backend is connected.</p>
      {dlg?.t === 'form' && <Modal title={dlg.m ? `Edit ${dlg.m.name}` : 'Add team member'} onClose={() => setDlg(null)}><MemberForm editing={dlg.m} onDone={() => setDlg(null)} /></Modal>}
      {dlg?.t === 'off' && <Modal title="Deactivate member" onClose={() => setDlg(null)}><Deactivate m={dlg.m} onDone={() => setDlg(null)} /></Modal>}
    </div>
  );
}
