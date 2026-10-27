import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Progress } from '../components/ui/card';
import { Empty } from '../components/ui/states';
import { useData } from '../data/store';
import { committedFor, paidFor, plannedProgress, projectProgress } from '../lib/calc';
import { dashboardMetrics } from '../lib/metrics';
import { isBehind } from '../lib/summary';
import { inlineField, money, pct } from '../lib/utils';
const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact' }).format(n);
export default function Dashboard() {
  const { db, today } = useData(), [fp, setFp] = useState<number | ''>(''), [horizon, setHorizon] = useState(14), m = dashboardMetrics(db, today, { project: fp, horizonDays: horizon }), cur = db.cur, b = m.budget;
  if (!db.P.length) return <Empty title="No projects yet" hint="Create your first project on the Projects page to see metrics here." />;
  const cards: [string, string, string?][] = [['Projects', String(m.total), `${m.active} active`], ['Completed', String(m.completed)], ['Delayed projects', String(m.delayed.length), 'behind plan or overdue tasks'], ['Overall progress', pct(m.progress), 'mean of projects'], ['Allocated budget', money(b.allocated, cur)], ['Actual expenditure', money(b.paid, cur), 'paid only'], ['Committed (pending)', money(b.committed, cur)], ['Remaining', money(b.remaining, cur), `${money(b.available, cur)} after commitments`], ['Overdue tasks', String(m.overdue.length)], ['Restock needed', String(m.low.length), 'materials'], ['Inventory value', money(m.inventoryValue, cur)], ['Active workforce', String(m.workforce.active), `${m.workforce.busy} with open tasks`], ['Inactive members', String(m.workforce.inactive)]];
  const chart = m.projects.map((p) => ({ name: p.name.length > 14 ? `${p.name.slice(0, 13)}…` : p.name, Budget: p.budget, Spent: paidFor(db.E, p.id) }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Overview</h1>
        <select aria-label="Project" value={fp} onChange={(e) => setFp(e.target.value === '' ? '' : Number(e.target.value))} className={inlineField}><option value="">All projects</option>{db.P.filter((p) => p.status !== 'Archived').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Upcoming deadlines window" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className={inlineField}>{[7, 14, 30, 90].map((n) => <option key={n} value={n}>Deadlines: next {n} days</option>)}</select></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(([l, v, s]) => <Card key={l}><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold sm:text-xl">{v}</div>{s && <div className="text-xs text-slate-500">{s}</div>}</Card>)}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><h2 className="mb-2 font-medium">Progress: actual vs planned</h2>{m.projects.length ? m.projects.map((p) => { const g = projectProgress(db.T.filter((t) => t.p === p.id)), pl = plannedProgress(p, today); return <div key={p.id} className="mb-2"><div className="flex justify-between text-xs"><Link className="underline" to={`/projects/${p.id}`}>{p.name}</Link><span>{g === null ? 'No tasks' : `${g}%`} / {pl}% planned</span></div><Progress label={`${p.name} progress`} value={g ?? 0} danger={isBehind(g, pl)} /></div>; }) : <p className="text-sm text-slate-500">No active projects.</p>}<p className="mt-1 text-xs text-slate-500">Planned % is an estimate: share of the schedule elapsed. Red = behind.</p></Card>
        <Card><h2 className="mb-2 font-medium">Budget vs actual ({cur})</h2><div className="h-64" role="img" aria-label="Bar chart of budget versus paid expenditure per project"><ResponsiveContainer><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: unknown) => money(Number(v), cur)} /><Legend />   <Bar isAnimationActive={false}dataKey="Budget" fill="#64748b" />   <Bar isAnimationActive={false}dataKey="Spent" fill="#e8890c" /></BarChart></ResponsiveContainer></div></Card>
        <Card><h2 className="mb-2 font-medium">Tasks needing attention</h2>{[...m.overdue, ...m.blocked.filter((t) => !m.overdue.includes(t))].slice(0, 6).map((t) => <div key={t.id} className="flex justify-between gap-2 border-b py-1 text-sm"><span>{t.title}</span>{t.status === 'Blocked' ? <Badge tone="warn">Blocked</Badge> : <Badge tone="bad">Overdue {t.due}</Badge>}</div>)}{!m.overdue.length && !m.blocked.length && <p className="text-sm text-slate-500">Nothing needs attention.</p>}</Card>
        <Card><h2 className="mb-2 font-medium">Upcoming deadlines ({horizon} days)</h2>{m.upcoming.length ? m.upcoming.slice(0, 6).map((t) => <div key={t.id} className="flex justify-between gap-2 border-b py-1 text-sm"><span>{t.title}</span><span className="text-slate-500">{t.due}</span></div>) : <p className="text-sm text-slate-500">No deadlines in this window.</p>}</Card>
        <Card><h2 className="mb-2 font-medium">Inventory alerts</h2>{m.low.length ? m.low.map((x) => <div key={x.id} className="flex justify-between border-b py-1 text-sm"><span>{x.name}</span><span>{x.qty} / min {x.min} {x.qty === 0 && <Badge tone="bad">Out</Badge>}</span></div>) : <p className="text-sm text-slate-500">All stock above minimum.</p>}</Card>
        <Card><h2 className="mb-2 font-medium">Workforce (open tasks)</h2>{m.workforce.load.length ? m.workforce.load.slice(0, 6).map((l) => <div key={l.name} className="flex justify-between border-b py-1 text-sm"><span>{l.name} <span className="text-xs text-slate-500">{l.role}</span></span><span>{l.open}</span></div>) : <p className="text-sm text-slate-500">No active team members.</p>}</Card>
        <Card><h2 className="mb-2 font-medium">Pending commitments</h2>{m.projects.map((p) => <div key={p.id} className="flex justify-between border-b py-1 text-sm"><span>{p.name}</span><span>{money(committedFor(db.E, p.id), cur)}</span></div>)}</Card>
        <Card><h2 className="mb-2 font-medium">Recent activity</h2>{db.act.length ? db.act.slice(0, 6).map((a, i) => <div key={i} className="flex justify-between gap-2 border-b py-1 text-sm"><span>{a[0]}</span><span className="text-slate-500">{a[1]}</span></div>) : <p className="text-sm text-slate-500">No activity yet.</p>}</Card>
      </div>
    </div>
  );
}