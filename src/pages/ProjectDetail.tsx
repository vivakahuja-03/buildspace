import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { FormError } from '../components/ui/field';
import { Modal } from '../components/ui/modal';
import { useAuth } from '../components/AuthGate';
import { Badge, Card, Progress } from '../components/ui/card';
import { Table } from '../components/ui/table';
import { useData } from '../data/store';
import { duration, isOverdue } from '../lib/calc';
import { addProgressUpdate, deletePhase, phaseProgress, savePhase } from '../lib/projects';
import { fieldCls } from '../lib/utils';
import type { Phase } from '../types';
import { canViewDocument } from '../lib/permissions';
import { projectSummary } from '../lib/summary';
import { cn, money, pct } from '../lib/utils';
const TABS = ['Overview', 'Phases', 'Tasks', 'Schedule', 'Team', 'Materials', 'Budget', 'Documents', 'Updates', 'Activity'] as const;
type Tab = (typeof TABS)[number];
const Stat = ({ label, children }: { label: string; children: ReactNode }) => <Card><div className="text-xs text-slate-500">{label}</div>{children}</Card>;
function PhaseDialog({ projectId, phase, onDone }: { projectId: number; phase: Phase | null; onDone: () => void }) {
  const { update, db } = useData(), p = db.P.find((x) => x.id === projectId), [name, setName] = useState(phase?.name ?? ''), [start, setStart] = useState(phase?.start ?? p?.start ?? ''), [end, setEnd] = useState(phase?.end ?? p?.end ?? ''), [err, setErr] = useState('');
  const save = () => { const r = update((d) => { savePhase(d, projectId, { name, start, end }, phase?.id); }, `Phase ${phase ? 'updated' : 'added'}: ${name}`, 'project:write'); if (r.ok) onDone(); else setErr(r.error); };
  return <div className="space-y-2"><FormError m={err} /><label className="block text-sm">Name<input className={fieldCls} value={name} onChange={(e) => setName(e.target.value)} /></label>
    <div className="grid grid-cols-2 gap-2"><label className="block text-sm">Start<input type="date" className={fieldCls} value={start} onChange={(e) => setStart(e.target.value)} /></label><label className="block text-sm">End<input type="date" className={fieldCls} value={end} onChange={(e) => setEnd(e.target.value)} /></label></div>
    <div className="flex gap-2 pt-2"><Button variant="primary" onClick={save}>Save phase</Button><Button onClick={onDone}>Cancel</Button></div></div>;
}
function UpdateForm({ projectId }: { projectId: number }) {
  const { update, today, role, can } = useData(), { user } = useAuth(), [note, setNote] = useState(''), [err, setErr] = useState('');
  if (!can('task:write')) return <p className="text-sm text-slate-500">Your role can read updates but not add them.</p>;
  const save = () => { const r = update((d) => addProgressUpdate(d, projectId, { note, by: user?.email ?? role, today }), 'Progress update recorded', 'task:write'); if (r.ok) { setNote(''); setErr(''); } else setErr(r.error); };
  return <div className="space-y-2"><FormError m={err} /><label className="block text-sm">Supervisor note<textarea rows={3} className={fieldCls} value={note} onChange={(e) => setNote(e.target.value)} /></label><Button variant="primary" onClick={save}>Record update</Button><p className="text-xs text-slate-500">The current progress percentage is calculated from the tasks and stored with the note.</p></div>;
}
export default function ProjectDetail() {
  const { id } = useParams(), { db, today, role, can, update } = useData(), [tab, setTab] = useState<Tab>('Overview'), [phaseDlg, setPhaseDlg] = useState<Phase | 'new' | null>(null), [perr, setPerr] = useState('');
  const s = projectSummary(db, Number(id), today);
  if (!s) return <Card>Project not found. <Link className="text-accent underline" to="/projects">Back to projects</Link></Card>;
  const { project: p, tasks } = s, cur = db.cur, people = [...new Set(tasks.map((t) => t.who))];
  const views: Record<Tab, ReactNode> = {
    Overview: <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-3">
      <Stat label="Progress"><div className="text-xl font-semibold">{pct(s.progress)}</div><Progress label="Project progress" value={s.progress ?? 0} danger={s.behind} /><div className="text-xs">Planned {s.planned}% (time elapsed) {s.behind && <Badge tone="bad">Behind schedule</Badge>}</div></Stat>
      <Stat label="Budget used"><div className="text-xl font-semibold">{s.utilization === null ? 'No budget' : `${s.utilization}%`}</div><Progress label="Budget used" value={s.utilization ?? 100} danger={s.utilization === null || s.utilization > 90} /><div className="text-xs">{money(s.paid, cur)} of {money(p.budget, cur)} {s.overBudgetRisk && <Badge tone="bad">Overrun risk</Badge>}</div></Stat>
      <Stat label="Overdue tasks"><div className="text-xl font-semibold">{s.overdue}</div></Stat></div>
      <h2 className="font-medium">Milestones</h2><Table head={['Milestone', 'Due', 'Status']} empty="No milestones." rows={tasks.filter((t) => t.ms).map((t) => [t.title, t.due, t.status])} />
      {p.budgetHistory?.length ? <><h2 className="font-medium">Budget revisions</h2><Table head={['Date', 'From', 'To', 'Reason']} rows={p.budgetHistory.map((h) => [h.date, money(h.from, cur), money(h.to, cur), h.reason])} /></> : null}</div>,
    Phases: <div className="space-y-3">{perr && <FormError m={perr} />}<div className="flex items-center"><h2 className="mr-auto font-medium">Phases</h2><Button disabled={!can('project:write')} onClick={() => setPhaseDlg('new')}>+ Add phase</Button></div>
      <Table head={['Phase', 'Dates', 'Tasks', 'Progress', '']} empty="No phases defined yet." rows={(p.phases ?? []).map((ph) => [ph.name, `${ph.start} → ${ph.end}`, tasks.filter((t) => t.phase === ph.id && t.status !== 'Cancelled').length, pct(phaseProgress(tasks, ph.id)), <span key="a" className="flex gap-1"><Button disabled={!can('project:write')} onClick={() => setPhaseDlg(ph)}>Edit</Button><Button variant="danger" disabled={!can('project:write')} onClick={() => { if (window.confirm(`Delete phase "${ph.name}"? Its tasks are kept.`)) { const r = update((d) => deletePhase(d, p.id, ph.id), `Phase deleted: ${ph.name}`, 'project:write'); setPerr(r.ok ? '' : r.error); } }}>Delete</Button></span>])} />
      <h2 className="font-medium">Milestones</h2><Table head={['Milestone', 'Phase', 'Due', 'Status']} empty="No milestones. Mark a task as a milestone when editing it." rows={tasks.filter((t) => t.ms).map((t) => [t.title, p.phases?.find((x) => x.id === t.phase)?.name ?? '—', t.due, t.status])} /></div>,
    Updates: <div className="space-y-3"><UpdateForm projectId={p.id} /><Table head={['Date', 'By', 'Progress', 'Note']} empty="No progress updates recorded yet." rows={(p.updates ?? []).map((u) => [u.date, u.by, pct(u.progress), u.note])} /></div>,
    Tasks: <Table head={['Task', 'Assignee', 'Status', 'Due', 'Done', 'After']} empty="No tasks in this project yet." rows={tasks.map((t) => [t.title, t.who, t.status, <span key="d">{t.due} {isOverdue(t, today) && <Badge tone="bad">Overdue</Badge>}</span>, `${t.status === 'Completed' ? 100 : t.pct}%`, db.T.find((x) => x.id === t.dep)?.title ?? '—'])} />,
    Schedule: <div className="space-y-2"><Table head={['Task', 'Start', 'End', 'Days']} empty="No tasks scheduled." rows={[...tasks].sort((a, b) => a.start.localeCompare(b.start)).map((t) => [t.title, t.start, t.due, duration(t.start, t.due)])} /><Link className="text-sm text-accent underline" to={`/schedule?project=${p.id}`}>Open full timeline</Link></div>,
    Team: <Table head={['Name', 'Role', 'Open tasks']} empty="No one is assigned yet." rows={people.map((n) => [n, db.M.find((m) => m.name === n)?.role ?? '—', tasks.filter((t) => t.who === n && t.status !== 'Completed' && t.status !== 'Cancelled').length])} />,
    Materials: <div><Table head={['Date', 'Material', 'Type', 'Qty']} empty="No consumption recorded against this project." rows={db.MV.filter((x) => x[4] === p.id).map((x) => [String(x[0]), String(x[1]), String(x[2]), String(x[3])])} /><p className="mt-2 text-xs text-slate-500">Shows consumption recorded against this project.</p></div>,
    Budget: <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-5"><Stat label="Allocated"><b>{money(p.budget, cur)}</b></Stat><Stat label="Paid (actual)"><b>{money(s.paid, cur)}</b></Stat><Stat label="Committed (pending)"><b>{money(s.committed, cur)}</b></Stat><Stat label="Remaining"><b>{money(s.remaining, cur)}</b></Stat><Stat label="Available after commitments"><b>{money(s.available, cur)}</b></Stat></div>
      <Table head={['Ref', 'Date', 'Category', 'Vendor', 'Amount', 'Status']} empty="No expenses recorded." rows={db.E.filter((e) => e.p === p.id).map((e) => [e.ref, e.date, e.cat, e.vendor, `${e.refund ? '−' : ''}${money(e.amt, cur)}`, e.refund ? `${e.status} (refund)` : e.status])} /></div>,
    Documents: <div><Table head={['Name', 'Category', 'Added']} empty="No documents yet. Upload from the Documents page." rows={db.DOC.filter((d) => d.p === p.id && canViewDocument(role, d.c)).map((d) => [d.n, d.c, d.d])} /><Link className="mt-2 inline-block text-sm text-accent underline" to="/documents">Manage documents</Link></div>,
    Activity: <div><Table head={['Event', 'Date']} empty="No recorded events mention this project." rows={db.act.filter((a) => a[0].includes(p.name)).map((a) => [a[0], a[1]])} /><p className="mt-2 text-xs text-slate-500">Lists events that mention this project by name.</p></div>,
  };
  return (
    <div className="space-y-3">
      <Link to="/projects" className="text-sm text-accent underline">← All projects</Link>
      <div><h1 className="text-xl font-semibold">{p.name}</h1><p className="text-sm text-slate-500">{p.loc} · {p.client ? `Client ${p.client} · ` : ''}Manager {p.mgr} · {p.start} → {p.end} · {p.status}</p>{p.desc && <p className="mt-1 text-sm">{p.desc}</p>}</div>
      <div role="tablist" aria-label="Project sections" className="flex flex-wrap gap-1">{TABS.map((t) => <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={t === tab} aria-controls="tabpanel" onClick={() => setTab(t)} className={cn('rounded-md border px-3 py-1 text-sm', t === tab ? 'border-accent bg-accent text-slate-900' : 'border-slate-300 dark:border-slate-600')}>{t}</button>)}</div>
      {phaseDlg && <Modal title={phaseDlg === 'new' ? 'Add phase' : `Edit ${phaseDlg.name}`} onClose={() => setPhaseDlg(null)}><PhaseDialog projectId={p.id} phase={phaseDlg === 'new' ? null : phaseDlg} onDone={() => setPhaseDlg(null)} /></Modal>}
      <Card role="tabpanel" id="tabpanel" aria-labelledby={`tab-${tab}`}>{views[tab]}</Card>
    </div>
  );
}
