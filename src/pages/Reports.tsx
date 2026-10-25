import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '../components/ui/button';
import { Badge, Card } from '../components/ui/card';
import { Empty, Notice } from '../components/ui/states';
import { Table } from '../components/ui/table';
import { useData } from '../data/store';
import { toCsv, type Cell } from '../lib/csv';
import { buildReport, defaultFilter, filterError, type ReportFilter } from '../lib/reports';
import { downloadBlob, inlineField, money, pct } from '../lib/utils';
import { TASK_STATUSES } from '../types';
const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact' }).format(n);
export default function Reports() {
  const { db, today } = useData(), cur = db.cur, [f, setF] = useState<ReportFilter>(defaultFilter());
  const err = filterError(f), r = buildReport(db, f, today), pn = (id: number) => db.P.find((p) => p.id === id)?.name ?? '—';
  const csv = (name: string, rows: Cell[][]) => downloadBlob(new Blob(['\uFEFF', toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `buildspace-${name}.csv`);
  const set = <K extends keyof ReportFilter>(k: K, v: ReportFilter[K]) => setF({ ...f, [k]: v });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Reports & Analytics</h1><Button className="no-print" onClick={() => window.print()}>Print</Button></div>
      <Card className="no-print"><div className="flex flex-wrap items-end gap-3" role="group" aria-label="Report filters">
        <label className="text-sm">Project<select className={inlineField + ' block'} value={f.project} onChange={(e) => set('project', e.target.value === 'all' ? 'all' : Number(e.target.value))}><option value="all">All active projects</option>{db.P.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === 'Archived' ? ' (archived)' : ''}</option>)}</select></label>
        <label className="text-sm">From<input type="date" className={inlineField + ' block'} value={f.from} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="text-sm">To<input type="date" className={inlineField + ' block'} value={f.to} onChange={(e) => set('to', e.target.value)} /></label>
        <label className="text-sm">Expenses<select className={inlineField + ' block'} value={f.expenseStatus} onChange={(e) => set('expenseStatus', e.target.value as ReportFilter['expenseStatus'])}><option>All</option><option>Paid</option><option>Pending</option></select></label>
        <Button onClick={() => setF(defaultFilter())}>Clear filters</Button></div></Card>
      {err && <Notice tone="error">{err}. Adjust the dates to see results.</Notice>}
      {!r ? null : !db.P.length ? <Empty title="No data to report on" hint="Create projects, tasks and expenses first." /> : (<>
        <Card><div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="mr-auto font-medium">Project progress & budget position</h2><Button className="no-print" onClick={() => csv('projects', [['project', 'status', 'progress_pct', 'planned_pct_estimate', 'allocated', 'paid', 'committed', 'remaining', 'utilization_pct', 'overdue_tasks'], ...r.projects.map((p) => [p.name, p.status, p.progress, p.planned, p.allocated, p.paid, p.committed, p.remaining, p.utilization, p.overdue])])}>Export CSV</Button></div>
          <Table head={['Project', 'Status', 'Progress', 'Planned*', 'Allocated', 'Paid', 'Committed', 'Remaining', 'Used', 'Overdue']} empty="No projects in scope." rows={[...r.projects.map((p) => [p.name, p.status, <span key="p">{pct(p.progress)} {p.behind && <Badge tone="bad">Behind</Badge>}</span>, `${p.planned}%`, money(p.allocated, cur), money(p.paid, cur), money(p.committed, cur), money(p.remaining, cur), p.utilization === null ? 'n/a' : `${p.utilization}%`, p.overdue]), ...(r.projects.length ? [['Total', '', '', '', money(r.totals.budget, cur), money(r.totals.paid, cur), money(r.totals.committed, cur), money(r.totals.remaining, cur), '', '']] : [])]} />
          <p className="mt-2 text-xs text-slate-500">*Planned % is an estimate (share of the schedule elapsed), not measured work. Budget figures are lifetime and are not limited by the date filter; they match the Overview page.</p></Card>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card><h2 className="mb-2 font-medium">Expenditure by category (net of refunds)</h2><div className="h-56" role="img" aria-label="Bar chart of expenditure by category">{r.expenses.byCategory.length ? <ResponsiveContainer><BarChart data={r.expenses.byCategory}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="cat" tick={{ fontSize: 11 }} /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: unknown) => money(Number(v), cur)} /><Bar dataKey="total" name={cur} fill="#e8890c" /></BarChart></ResponsiveContainer> : <p className="p-4 text-sm text-slate-500">No expenses in this period.</p>}</div></Card>
          <Card><h2 className="mb-2 font-medium">Monthly expenditure (net of refunds)</h2><div className="h-56" role="img" aria-label="Bar chart of monthly expenditure">{r.expenses.byMonth.length ? <ResponsiveContainer><BarChart data={r.expenses.byMonth}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: unknown) => money(Number(v), cur)} /><Bar dataKey="total" name={cur} fill="#64748b" /></BarChart></ResponsiveContainer> : <p className="p-4 text-sm text-slate-500">No expenses in this period.</p>}</div></Card></div>
        <Card><div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="mr-auto font-medium">Expenses in period — {money(r.expenses.total, cur)} ({r.expenses.rows.length})</h2><Button className="no-print" onClick={() => csv('expenses', [['ref', 'date', 'project', 'category', 'vendor', 'type', 'amount', 'status', 'invoice'], ...r.expenses.rows.map((x) => [x.ref, x.date, pn(x.p), x.cat, x.vendor, x.refund ? 'Refund' : 'Expense', x.refund ? -x.amt : x.amt, x.status, x.inv])])}>Export CSV</Button></div>
          <Table head={['Ref', 'Date', 'Project', 'Category', 'Vendor', 'Amount', 'Status']} empty="No expenses in this period." rows={r.expenses.rows.slice(0, 50).map((x) => [x.ref, x.date, pn(x.p), x.cat, x.vendor, `${x.refund ? '−' : ''}${money(x.amt, cur)}`, x.status])} />{r.expenses.rows.length > 50 && <p className="mt-1 text-xs text-slate-500">Showing 50 of {r.expenses.rows.length}; the CSV contains all rows.</p>}</Card>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card><div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="mr-auto font-medium">Task completion</h2><Button className="no-print" onClick={() => csv('tasks', [['title', 'project', 'assignee', 'status', 'priority', 'start', 'due', 'completion_pct'], ...r.tasks.rows.map((t) => [t.title, pn(t.p), t.who, t.status, t.pri ?? 'Medium', t.start, t.due, t.status === 'Completed' ? 100 : t.pct])])}>Export CSV</Button></div>
            <p className="text-sm">Completion rate: <b>{pct(r.tasks.completionRate)}</b> ({r.tasks.completed} of {r.tasks.total} tasks, cancelled excluded) · Overdue: <b>{r.tasks.overdue}</b></p>
            <Table head={['Status', 'Tasks']} rows={TASK_STATUSES.map((s) => [s, r.tasks.byStatus[s]])} /><p className="mt-1 text-xs text-slate-500">With dates set, tasks that overlap the selected period are included.</p></Card>
          <Card><h2 className="mb-2 font-medium">Team workload (open tasks)</h2><Table head={['Name', 'Role', 'Availability', 'Open', 'Done']} empty="No active team members." rows={r.team.map((t) => [t.name, t.role, t.availability, t.open, t.done])} /></Card></div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card><div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="mr-auto font-medium">Material usage (consumed)</h2><Button className="no-print" onClick={() => csv('material-usage', [['material', 'unit', 'quantity', 'estimated_cost'], ...r.materials.usage.map((u) => [u.name, u.unit, u.qty, u.estCost])])}>Export CSV</Button></div>
            <Table head={['Material', 'Qty', 'Est. cost*']} empty="No consumption recorded in this period." rows={r.materials.usage.map((u) => [u.name, `${u.qty} ${u.unit}`, money(u.estCost, cur)])} /><p className="mt-2 text-sm">Estimated total: <b>{money(r.materials.estCostTotal, cur)}</b></p><p className="text-xs text-slate-500">*Estimate: quantity × the material’s current unit cost, not the price paid at the time.</p></Card>
          <Card><div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="mr-auto font-medium">Inventory</h2><Button className="no-print" onClick={() => csv('inventory', [['sku', 'name', 'qty', 'unit', 'min', 'unit_cost'], ...db.I.map((m) => [m.sku, m.name, m.qty, m.unit, m.min, m.cost])])}>Export CSV</Button></div>
            <p className="text-sm">Valuation: <b>{money(r.inventory.value, cur)}</b> (current stock × unit cost)</p><Table head={['Low or out of stock', 'Qty', 'Min']} empty="All stock above minimum." rows={r.inventory.low.map((m) => [m.name, `${m.qty} ${m.unit}`, m.min])} /></Card></div>
        <Card><div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="mr-auto font-medium">Purchase requests</h2><Button className="no-print" onClick={() => csv('purchase-requests', [['id', 'material', 'project', 'quantity', 'requested', 'status', 'approved_by'], ...r.purchases.rows.map((o) => [o.id, db.I.find((m) => m.id === o.m)?.name, o.p === undefined ? '' : pn(o.p), o.q, o.date, o.status, o.approvedBy])])}>Export CSV</Button></div>
          <p className="text-sm">{r.purchases.byStatus.map((s) => `${s.status}: ${s.count}`).join(' · ')} · Open (approved/ordered) value*: <b>{money(r.purchases.openValue, cur)}</b></p>
          <Table head={['#', 'Material', 'Project', 'Qty', 'Requested', 'Status', 'Approved by']} empty="No purchase requests in this period." rows={r.purchases.rows.map((o) => [o.id, db.I.find((m) => m.id === o.m)?.name ?? '—', o.p === undefined ? '—' : pn(o.p), o.q, o.date ?? '—', o.status, o.approvedBy ?? '—'])} /><p className="mt-1 text-xs text-slate-500">*Estimate at current unit cost; not part of committed costs.</p></Card>
      </>)}
    </div>
  );
}