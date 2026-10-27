import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { z } from 'zod';
import { Button } from '../components/ui/button';
import { Badge, Card } from '../components/ui/card';
import { Field, FormActions, FormError } from '../components/ui/field';
import { Modal } from '../components/ui/modal';
import { Empty, Notice } from '../components/ui/states';
import { Table } from '../components/ui/table';
import { useData } from '../data/store';
import { committedFor, paidFor } from '../lib/calc';
import { openPurchaseValue } from '../lib/inventory';
import { budgetPosition, deleteExpense, markExpensePaid, monthlyTotals, netTotal, saveExpense, totalsByCategory } from '../lib/finance';
import { fieldCls, inlineField, money } from '../lib/utils';
import { EXPENSE_CATEGORIES, type Expense } from '../types';
const schema = z.object({ p: z.number({ invalid_type_error: 'Choose a project' }), cat: z.enum(EXPENSE_CATEGORIES), vendor: z.string().min(2, 'Vendor is required'), date: z.string().min(1, 'Date is required'), amt: z.number({ invalid_type_error: 'Enter an amount' }).positive('Amount must be greater than 0'), status: z.enum(['Paid', 'Pending']), kind: z.enum(['Expense', 'Refund']), inv: z.string().optional(), notes: z.string().optional() });
type Form = z.infer<typeof schema>;
const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact' }).format(n);
function ExpenseForm({ editing, defaultProject, onDone }: { editing: Expense | null; defaultProject: number | undefined; onDone: () => void }) {
  const { db, today, update } = useData(), [err, setErr] = useState('');
  const projects = db.P.filter((p) => p.status !== 'Archived' || p.id === editing?.p), locked = editing?.status === 'Paid';
  const { register, handleSubmit, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: editing ? { p: editing.p, cat: editing.cat as Form['cat'], vendor: editing.vendor, date: editing.date, amt: editing.amt, status: editing.status, kind: editing.refund ? 'Refund' : 'Expense', inv: editing.inv ?? '', notes: editing.notes ?? '' } : { p: defaultProject ?? projects[0]?.id, cat: 'Materials', vendor: '', date: today, status: 'Pending', kind: 'Expense', inv: '', notes: '' } });
  const submit = handleSubmit((v) => { const r = update((d) => { saveExpense(d, { p: v.p, cat: v.cat, vendor: v.vendor, date: v.date, amt: v.amt, status: v.status, refund: v.kind === 'Refund', inv: v.inv, notes: v.notes }, editing?.id); }, `Expense ${editing ? 'updated' : 'added'}: ${money(v.amt, db.cur)} (${v.vendor})`, 'finance:write'); if (r.ok) onDone(); else setErr(r.error); });
  return <form onSubmit={submit} className="space-y-2" noValidate><FormError m={err} />
    {locked && <p className="text-xs text-slate-500">This expense is paid, so project, date, amount, status and type are locked and changes to them will be rejected. To correct them, record a refund/reversal.</p>}
    <Field label="Project" error={errors.p?.message}><select className={fieldCls} {...register('p', { valueAsNumber: true })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    <Field label="Type"><select className={fieldCls} {...register('kind')}><option>Expense</option><option>Refund</option></select></Field>
    <Field label="Category" error={errors.cat?.message}><select className={fieldCls} {...register('cat')}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
    <Field label="Vendor" error={errors.vendor?.message}><input className={fieldCls} {...register('vendor')} /></Field>
    <Field label="Date" error={errors.date?.message}><input type="date" readOnly={locked} className={fieldCls} {...register('date')} /></Field>
    <Field label={`Amount (${db.cur})`} error={errors.amt?.message}><input type="number" step="0.01" readOnly={locked} className={fieldCls} {...register('amt', { valueAsNumber: true })} /></Field>
    <Field label="Status (refunds must be Paid)"><select className={fieldCls} {...register('status')}><option>Pending</option><option>Paid</option></select></Field>
    <Field label="Invoice / receipt no. (optional)"><input className={fieldCls} {...register('inv')} /></Field>
    <Field label="Notes (optional)"><input className={fieldCls} {...register('notes')} /></Field>
    <FormActions onCancel={onDone} /></form>;
}
export default function Budget() {
  const { db, can, update } = useData(), cur = db.cur, w = can('finance:write');
  const [proj, setProj] = useState(''), [status, setStatus] = useState(''), [cat, setCat] = useState(''), [q, setQ] = useState(''), [dlg, setDlg] = useState<Expense | 'new' | null>(null), [err, setErr] = useState('');
  const projects = db.P.filter((p) => p.status !== 'Archived');
  const list = db.E.filter((x) => (!proj || x.p === Number(proj)) && (!status || x.status === status) && (!cat || x.cat === cat) && (!q || `${x.vendor} ${x.ref} ${x.inv ?? ''}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.date.localeCompare(a.date));
  const run = (r: ReturnType<typeof update>) => setErr(r.ok ? '' : r.error);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Budget & Expenses</h1><Button variant="primary" disabled={!w || !projects.length} title={w ? undefined : 'Your role cannot record expenses'} onClick={() => setDlg('new')}>+ Add expense</Button></div>
      {err && <Notice tone="error" onClose={() => setErr('')}>{err}</Notice>}
      {!projects.length ? <Empty title="No active projects" hint="Create a project to track its budget." /> : <Card><h2 className="mb-2 font-medium">Project budgets</h2>
        <Table head={['Project', 'Allocated', 'Paid (actual)', 'Committed (pending)', 'Open purchase requests*', 'Remaining', 'Used', 'Alert']} rows={projects.map((p) => { const b = budgetPosition(p.budget, paidFor(db.E, p.id), committedFor(db.E, p.id)); return [p.name, p.budget > 0 ? money(p.budget, cur) : 'No budget set', money(b.paid, cur), money(b.committed, cur), money(openPurchaseValue(db, p.id), cur), money(b.remaining, cur), b.utilization === null ? 'n/a' : `${b.utilization}%`, b.alert === 'over' ? <Badge key="a" tone="bad">{b.remaining < 0 ? 'Over budget' : 'Over budget if pending is paid'}</Badge> : b.alert === 'high' ? <Badge key="a" tone="warn">Above 90% used</Badge> : '—']; })} />
        <p className="mt-2 text-xs text-slate-500">Allocated = project budget. Paid = actual expenditure (net of refunds). Committed = pending expenses. Remaining = allocated − paid; pending amounts are never counted twice. Edit a project’s budget on the Projects page. *Approved/ordered purchase requests (estimated at current unit cost) are shown beside, not inside, committed costs; once the invoice is recorded as an expense it is counted there instead, so nothing is counted twice.</p></Card>}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card><h2 className="mb-2 font-medium">Spending by category (filtered, net of refunds)</h2><div className="h-56" role="img" aria-label="Bar chart of spending by category"><ResponsiveContainer><BarChart data={totalsByCategory(list)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="cat" tick={{ fontSize: 11 }} /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: unknown) => money(Number(v), cur)} />   <Bar isAnimationActive={false}dataKey="total" name={cur} fill="#e8890c" /></BarChart></ResponsiveContainer></div></Card>
        <Card><h2 className="mb-2 font-medium">Monthly expenditure (filtered, net of refunds)</h2><div className="h-56" role="img" aria-label="Bar chart of monthly expenditure"><ResponsiveContainer><BarChart data={monthlyTotals(list)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: unknown) => money(Number(v), cur)} />   <Bar isAnimationActive={false}dataKey="total" name={cur} fill="#64748b" /></BarChart></ResponsiveContainer></div></Card></div>
      <Card><div className="mb-2 flex flex-wrap gap-2"><h2 className="mr-auto font-medium">Expenses</h2>
        <select aria-label="Filter by project" value={proj} onChange={(e) => setProj(e.target.value)} className={inlineField}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className={inlineField}><option value="">All statuses</option><option>Paid</option><option>Pending</option></select>
        <select aria-label="Filter by category" value={cat} onChange={(e) => setCat(e.target.value)} className={inlineField}><option value="">All categories</option>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        <input type="search" aria-label="Search expenses" placeholder="Vendor, reference or invoice" value={q} onChange={(e) => setQ(e.target.value)} className={inlineField} /></div>
        <Table head={['Ref', 'Date', 'Project', 'Category', 'Vendor', 'Amount', 'Status', '']} empty="No expenses match these filters." rows={list.map((x) => [x.ref, x.date, db.P.find((p) => p.id === x.p)?.name ?? '—', x.cat, x.vendor, `${x.refund ? '−' : ''}${money(x.amt, cur)}`, <span key="s"><Badge tone={x.status === 'Paid' ? 'ok' : 'warn'}>{x.status}</Badge>{x.refund && <> <Badge>Refund</Badge></>}</span>,
          <span key="a" className="flex gap-1"><Button disabled={!w} onClick={() => setDlg(x)}>Edit</Button>{x.status === 'Pending' && <><Button disabled={!w} onClick={() => run(update((d) => markExpensePaid(d, x.id), `Expense ${x.ref} marked paid`, 'finance:write'))}>Mark paid</Button><Button variant="danger" disabled={!w} onClick={() => { if (window.confirm(`Delete pending expense ${x.ref}?`)) run(update((d) => deleteExpense(d, x.id), `Expense ${x.ref} deleted`, 'finance:write')); }}>Delete</Button></>}</span>])} />
        <p className="mt-2 text-sm"><b>Filtered net total:</b> {money(netTotal(list), cur)}</p></Card>
      {dlg && <Modal title={dlg === 'new' ? 'Add expense' : `Edit ${dlg.ref}`} onClose={() => setDlg(null)}><ExpenseForm editing={dlg === 'new' ? null : dlg} defaultProject={proj ? Number(proj) : undefined} onDone={() => setDlg(null)} /></Modal>}
    </div>
  );
}