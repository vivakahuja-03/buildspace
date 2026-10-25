import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Field, FormActions, FormError } from '../components/ui/field';
import { Modal } from '../components/ui/modal';
import { Empty, Notice } from '../components/ui/states';
import { useData } from '../data/store';
import { projectProgress } from '../lib/calc';
import { deleteProject, saveProject, setProjectStatus } from '../lib/projects';
import { fieldCls, inlineField, money } from '../lib/utils';
import { PROJECT_STATUSES, type Project, type ProjectStatus } from '../types';
const schema = z.object({ name: z.string().min(2, 'Name is required'), mgr: z.string().min(1, 'Choose a manager'), loc: z.string().min(1, 'Location is required'), start: z.string().min(1, 'Start date is required'), end: z.string().min(1, 'Completion date is required'), budget: z.number({ invalid_type_error: 'Budget must be a number' }).min(0, 'Budget cannot be negative'), reason: z.string().optional(), desc: z.string().optional(), client: z.string().optional() }).refine((v) => v.end >= v.start, { message: 'Completion must be on or after the start date', path: ['end'] });
type Form = z.infer<typeof schema>;
const progressLabel = (g: number | null) => (g === null ? 'No tasks' : `${g}%`);
function ProjectForm({ editing, onDone }: { editing: Project | null; onDone: () => void }) {
  const { db, today, update } = useData(), [err, setErr] = useState('');
  const mgrs = db.M.filter((m) => (m.active || m.name === editing?.mgr) && (m.role === 'Project Manager' || m.role === 'Administrator')).map((m) => m.name);
  const { register, handleSubmit, watch, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: editing ? { name: editing.name, mgr: editing.mgr, loc: editing.loc, start: editing.start, end: editing.end, budget: editing.budget, reason: '', desc: editing.desc ?? '', client: editing.client ?? '' } : { start: today, mgr: '', name: '', loc: '', end: '', reason: '', desc: '', client: '' } });
  const budgetChanged = editing !== null && Number(watch('budget')) !== editing.budget;
  const submit = handleSubmit((v) => { const r = update((d) => { saveProject(d, v, today, editing?.id); }, `Project ${editing ? 'updated' : 'created'}: ${v.name}`, 'project:write'); if (r.ok) onDone(); else setErr(r.error); });
  return <form onSubmit={submit} className="space-y-2" noValidate>
    <FormError m={err} />
    <Field label="Name" error={errors.name?.message}><input className={fieldCls} {...register('name')} /></Field>
    <Field label="Manager" error={errors.mgr?.message}><select className={fieldCls} {...register('mgr')}><option value="">Choose…</option>{mgrs.map((m) => <option key={m}>{m}</option>)}</select></Field>
    <Field label="Client (optional)" error={errors.client?.message}><input className={fieldCls} {...register('client')} /></Field>
    <Field label="Description (optional)" error={errors.desc?.message}><textarea rows={3} className={fieldCls} {...register('desc')} /></Field>
    <Field label="Location" error={errors.loc?.message}><input className={fieldCls} {...register('loc')} /></Field>
    <Field label="Start date" error={errors.start?.message}><input type="date" className={fieldCls} {...register('start')} /></Field>
    <Field label="Target completion" error={errors.end?.message}><input type="date" className={fieldCls} {...register('end')} /></Field>
    <Field label={`Budget (${db.cur})`} error={errors.budget?.message}><input type="number" step="0.01" className={fieldCls} {...register('budget', { valueAsNumber: true })} /></Field>
    {budgetChanged && <Field label="Reason for budget revision" error={errors.reason?.message}><input className={fieldCls} {...register('reason')} /></Field>}
    <FormActions onCancel={onDone} /></form>;
}
export default function Projects() {
  const { db, can, update } = useData(), [dlg, setDlg] = useState<Project | 'new' | null>(null), [filter, setFilter] = useState(''), [err, setErr] = useState('');
  const rows = db.P.filter((p) => !filter || p.status === filter), w = can('project:write');
  const setStatus = (p: Project, s: ProjectStatus) => { const r = update((d) => setProjectStatus(d, p.id, s), `${p.name} status → ${s}`, 'project:write'); setErr(r.ok ? '' : r.error); };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Projects</h1>
        <select aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value)} className={inlineField}><option value="">All statuses</option>{PROJECT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <Button variant="primary" disabled={!w} title={w ? undefined : 'Your role cannot create projects'} onClick={() => setDlg('new')}>+ New project</Button></div>
      {err && <Notice tone="error" onClose={() => setErr('')}>{err}</Notice>}
      {!db.P.length ? <Empty title="No projects yet" hint="Create a project to get started." /> : (
        <Card className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th scope="col" className="p-2">Project</th><th scope="col">Manager</th><th scope="col">Location</th><th scope="col">Deadline</th><th scope="col">Budget</th><th scope="col">Progress</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id} className="whitespace-nowrap border-t"><td className="p-2"><Link className="text-accent underline" to={`/projects/${p.id}`}>{p.name}</Link></td><td>{p.mgr}</td><td>{p.loc}</td><td>{p.end}</td><td>{money(p.budget, db.cur)}</td><td>{progressLabel(projectProgress(db.T.filter((t) => t.p === p.id)))}</td>
            <td><select aria-label={`Status of ${p.name}`} disabled={!w} value={p.status} className={inlineField} onChange={(e) => setStatus(p, e.target.value as ProjectStatus)}>{PROJECT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></td>
            <td className="space-x-1"><Button disabled={!w} onClick={() => setDlg(p)}>Edit</Button><Button variant="danger" disabled={!can('project:delete')} title={can('project:delete') ? 'Permanent; only for projects with no records' : 'Only an Administrator can delete projects'} onClick={() => { if (window.confirm(`Permanently delete "${p.name}"? This only works for projects with no tasks, expenses or documents.`)) { const r = update((d) => deleteProject(d, p.id), `Project deleted: ${p.name}`, 'project:delete'); setErr(r.ok ? '' : r.error); } }}>Delete</Button><Button variant="danger" disabled={!w || p.status === 'Archived'} onClick={() => { if (window.confirm(`Archive "${p.name}"? Its records stay available in reports.`)) setStatus(p, 'Archived'); }}>Archive</Button></td></tr>)}</tbody></table>
          {!rows.length && <p className="p-3 text-sm text-slate-500">No projects match this filter.</p>}</Card>)}
      {dlg && <Modal title={dlg === 'new' ? 'New project' : `Edit ${dlg.name}`} onClose={() => setDlg(null)}><ProjectForm editing={dlg === 'new' ? null : dlg} onDone={() => setDlg(null)} /></Modal>}
    </div>
  );
}
