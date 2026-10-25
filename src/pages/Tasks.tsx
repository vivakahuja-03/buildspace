import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../components/ui/button';
import { Badge, Card, Progress } from '../components/ui/card';
import { Field, FormActions, FormError } from '../components/ui/field';
import { Modal } from '../components/ui/modal';
import { Notice } from '../components/ui/states';
import { useData } from '../data/store';
import { isOverdue } from '../lib/calc';
import { deleteTask, filterTasks, saveTask, setTaskStatus, sortTasks, type SortKey } from '../lib/tasks';
import { fieldCls, inlineField } from '../lib/utils';
import { PRIORITIES, TASK_STATUSES, type Priority, type Task, type TaskStatus } from '../types';
const schema = z.object({
  title: z.string().min(2, 'Title is required'), p: z.number({ invalid_type_error: 'Choose a project' }), who: z.string().min(1, 'Choose an assignee'),
  start: z.string().min(1, 'Start date is required'), due: z.string().min(1, 'Due date is required'),
  pct: z.number({ invalid_type_error: 'Enter a number from 0 to 100' }).int('Whole numbers only').min(0, 'Min 0').max(100, 'Max 100'),
  pri: z.enum(PRIORITIES), dep: z.union([z.literal(''), z.number()]), desc: z.string().optional(), ms: z.boolean(), phase: z.union([z.literal(''), z.number()]),
}).refine((v) => v.due >= v.start, { message: 'Due date must be on or after start', path: ['due'] });
type Form = z.infer<typeof schema>;
const PRI_TONE: Record<Priority, 'neutral' | 'warn' | 'bad'> = { Low: 'neutral', Medium: 'neutral', High: 'warn', Critical: 'bad' };
export function TaskForm({ editing, defaultProject, onDone }: { editing: Task | null; defaultProject: number | ''; onDone: () => void }) {
  const { db, today, update } = useData(), [err, setErr] = useState('');
  const projects = db.P.filter((p) => p.status !== 'Archived'), people = db.M.filter((m) => m.active || m.name === editing?.who);
  const { register, handleSubmit, watch, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: editing ? { title: editing.title, p: editing.p, who: editing.who, start: editing.start, due: editing.due, pct: editing.pct, pri: editing.pri ?? 'Medium', dep: editing.dep, desc: editing.desc ?? '', ms: editing.ms, phase: editing.phase ?? '' } : { title: '', p: defaultProject === '' ? projects[0]?.id : defaultProject, who: '', start: today, due: '', pct: 0, pri: 'Medium', dep: '', desc: '', ms: false, phase: '' } });
  const proj = Number(watch('p'));
  const submit = handleSubmit((v) => { const r = update((d) => { saveTask(d, v, editing?.id); }, `Task ${editing ? 'updated' : 'created'}: ${v.title}`, 'task:write'); if (r.ok) onDone(); else setErr(r.error); });
  return <form onSubmit={submit} className="space-y-2" noValidate>
    <FormError m={err} />
    <Field label="Title" error={errors.title?.message}><input className={fieldCls} {...register('title')} /></Field>
    <Field label="Project" error={errors.p?.message}><select className={fieldCls} {...register('p', { valueAsNumber: true })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    <Field label="Assignee" error={errors.who?.message}><select className={fieldCls} {...register('who')}><option value="">Choose…</option>{people.map((m) => <option key={m.name} value={m.name}>{m.name}{m.active ? '' : ' (inactive)'}</option>)}</select></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Start" error={errors.start?.message}><input type="date" className={fieldCls} {...register('start')} /></Field><Field label="Due" error={errors.due?.message}><input type="date" className={fieldCls} {...register('due')} /></Field></div>
    <div className="grid grid-cols-2 gap-2"><Field label="Completion %" error={errors.pct?.message}><input type="number" className={fieldCls} {...register('pct', { valueAsNumber: true })} /></Field><Field label="Priority" error={errors.pri?.message}><select className={fieldCls} {...register('pri')}>{PRIORITIES.map((x) => <option key={x}>{x}</option>)}</select></Field></div>
    <Field label="Description (optional)" error={errors.desc?.message}><textarea rows={2} className={fieldCls} {...register('desc')} /></Field>
    <Field label="Phase (optional)" error={errors.phase?.message}><select className={fieldCls} {...register('phase', { setValueAs: (x: string) => (x === '' ? '' : Number(x)) })}><option value="">None</option>{(db.P.find((p) => p.id === proj)?.phases ?? []).map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}</select></Field>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('ms')} />This task is a milestone</label>
    <Field label="Starts after (dependency)" error={errors.dep?.message}><select className={fieldCls} {...register('dep', { setValueAs: (x: string) => (x === '' ? '' : Number(x)) })}><option value="">None</option>{db.T.filter((x) => x.id !== editing?.id && x.p === proj).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>
    <FormActions onCancel={onDone} /></form>;
}
export default function Tasks() {
  const { db, today, can, update } = useData();
  const [f, setF] = useState<{ project: number | ''; status: TaskStatus | ''; who: string; pri: Priority | ''; q: string; overdueOnly: boolean }>({ project: '', status: '', who: '', pri: '', q: '', overdueOnly: false });
  const [dlg, setDlg] = useState<Task | 'new' | null>(null), [err, setErr] = useState(''), [sort, setSort] = useState<SortKey>('due'), [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const visible = db.T.filter((t) => db.P.some((p) => p.id === t.p && p.status !== 'Archived'));
  const tasks = sortTasks(filterTasks(visible, f, today), sort, dir), writeOk = can('task:write'), statusOk = can('task:status');
  const move = (t: Task, s: TaskStatus) => { if (t.status === s) return; const r = update((d) => setTaskStatus(d, t.id, s), `Task "${t.title}" → ${s}`, 'task:status'); setErr(r.ok ? '' : r.error); };
  const del = (t: Task) => { const n = db.T.filter((x) => x.dep === t.id).length; if (!window.confirm(n ? `${n} task(s) depend on this one and will lose that link. Delete "${t.title}"?` : `Delete "${t.title}"? Consider setting it to Cancelled to keep history.`)) return; const r = update((d) => deleteTask(d, t.id), `Task deleted: ${t.title}`, 'task:write'); setErr(r.ok ? '' : r.error); };
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Tasks</h1><Button variant="primary" disabled={!writeOk} title={writeOk ? undefined : 'Your role cannot create tasks'} onClick={() => setDlg('new')}>+ New task</Button></div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Task filters">
        <select aria-label="Filter by project" value={f.project} onChange={(e) => set('project', e.target.value === '' ? '' : Number(e.target.value))} className={inlineField}><option value="">All projects</option>{db.P.filter((p) => p.status !== 'Archived').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Filter by status" value={f.status} onChange={(e) => set('status', e.target.value as TaskStatus | '')} className={inlineField}><option value="">All statuses</option>{TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <select aria-label="Filter by assignee" value={f.who} onChange={(e) => set('who', e.target.value)} className={inlineField}><option value="">Everyone</option>{db.M.map((m) => <option key={m.name}>{m.name}</option>)}</select>
        <select aria-label="Filter by priority" value={f.pri} onChange={(e) => set('pri', e.target.value as Priority | '')} className={inlineField}><option value="">Any priority</option>{PRIORITIES.map((x) => <option key={x}>{x}</option>)}</select>
        <input type="search" aria-label="Search tasks" placeholder="Search tasks" value={f.q} onChange={(e) => set('q', e.target.value)} className={inlineField} />
        <select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={inlineField}><option value="due">Sort: due date</option><option value="start">Sort: start date</option><option value="priority">Sort: priority</option><option value="title">Sort: title</option><option value="status">Sort: status</option></select>
        <select aria-label="Sort direction" value={dir} onChange={(e) => setDir(e.target.value as 'asc' | 'desc')} className={inlineField}><option value="asc">Ascending</option><option value="desc">Descending</option></select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.overdueOnly} onChange={(e) => set('overdueOnly', e.target.checked)} />Overdue only</label></div>
      {err && <Notice tone="error" onClose={() => setErr('')}>{err}</Notice>}
      <p className="text-xs text-slate-500">Drag a card to another column, or use the status menu on each card. Finished work must be reopened deliberately; a task cannot start before its predecessor finishes.</p>
      <div className="grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
        {TASK_STATUSES.map((s) => { const col = tasks.filter((t) => t.status === s); return (
          <Card key={s} className="bg-slate-50 dark:bg-slate-900" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = Number(e.dataTransfer.getData('text')), t = db.T.find((x) => x.id === id); if (t && statusOk) move(t, s); }}>
            <h2 className="mb-2 text-sm font-medium">{s} ({col.length})</h2>
            {!col.length && <p className="text-xs text-slate-500">No tasks</p>}
            {col.map((t) => (
              <div key={t.id} draggable={statusOk} onDragStart={(e) => e.dataTransfer.setData('text', String(t.id))} className="mb-2 rounded border border-slate-200 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800">
                <div className="flex justify-between gap-1"><span className="font-medium">{t.ms ? '◆ ' : ''}{t.title}</span><Badge tone={PRI_TONE[t.pri ?? 'Medium']}>{t.pri ?? 'Medium'}</Badge></div>
                <div className="text-xs text-slate-500">{db.P.find((p) => p.id === t.p)?.name} · {t.who}{db.M.find((m) => m.name === t.who)?.active === false ? ' (inactive)' : ''}</div>
                {t.dep !== '' && <div className="text-xs text-slate-500">↳ after: {db.T.find((x) => x.id === t.dep)?.title ?? '—'}</div>}
                <div className="my-1"><Progress label={`${t.title} progress`} value={t.status === 'Completed' ? 100 : t.pct} /></div>
                <div className="text-xs">Due {t.due} {isOverdue(t, today) && <Badge tone="bad">Overdue</Badge>}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <select aria-label={`Move ${t.title}`} disabled={!statusOk} value={t.status} onChange={(e) => move(t, e.target.value as TaskStatus)} className={`${inlineField} !py-0.5 text-xs`}>{TASK_STATUSES.map((x) => <option key={x}>{x}</option>)}</select>
                  <Button className="!px-2 !py-0.5 text-xs" disabled={!writeOk} onClick={() => setDlg(t)}>Edit</Button>
                  <Button aria-label={`Archive ${t.title}`} title="Archive (set to Cancelled; history is kept)" disabled={!writeOk || t.status === 'Cancelled'} className="!px-2 !py-0.5 text-xs" onClick={() => move(t, 'Cancelled')}>Archive</Button>
                  <Button variant="danger" aria-label={`Delete ${t.title}`} disabled={!writeOk} className="!px-2 !py-0.5 text-xs" onClick={() => del(t)}>✕</Button>
                </div>
              </div>))}
          </Card>); })}
      </div>
      {dlg && <Modal title={dlg === 'new' ? 'New task' : 'Edit task'} onClose={() => setDlg(null)}><TaskForm editing={dlg === 'new' ? null : dlg} defaultProject={f.project} onDone={() => setDlg(null)} /></Modal>}
    </div>
  );
}
