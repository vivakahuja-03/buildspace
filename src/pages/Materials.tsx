import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../components/ui/button';
import { Badge, Card } from '../components/ui/card';
import { Field, FormActions, FormError } from '../components/ui/field';
import { Modal } from '../components/ui/modal';
import { Empty, Notice } from '../components/ui/states';
import { Table } from '../components/ui/table';
import { useData } from '../data/store';
import { inventoryValue, isLowStock } from '../lib/calc';
import { PO_NEXT, UNITS, adjustStock, advancePurchaseOrder, cancelPurchaseOrder, createPurchaseRequest, moveStock, saveMaterial } from '../lib/inventory';
import { fieldCls, inlineField, money, newOpId } from '../lib/utils';
import type { Material } from '../types';
type Dlg = { t: 'edit'; m: Material | null } | { t: 'move'; m: Material; kind: 'in' | 'out' } | { t: 'adjust'; m: Material } | { t: 'po' } | null;
const num = (label: string) => z.number({ invalid_type_error: `${label} must be a number` }).min(0, `${label} cannot be negative`);
const matSchema = z.object({ name: z.string().min(2, 'Name is required'), cat: z.string().min(1, 'Category is required'), unit: z.string().min(1, 'Unit is required'), qty: num('Quantity'), min: num('Minimum'), cost: num('Unit cost'), sup: z.string().min(1, 'Supplier is required') });
function MaterialForm({ m, onDone }: { m: Material | null; onDone: () => void }) {
  const { db, today, update } = useData(), [err, setErr] = useState('');
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof matSchema>>({ resolver: zodResolver(matSchema), defaultValues: m ? { name: m.name, cat: m.cat, unit: m.unit, qty: m.qty, min: m.min, cost: m.cost, sup: m.sup } : { name: '', cat: '', unit: '', qty: 0, min: 0, cost: 0, sup: '' } });
  const n = (k: 'qty' | 'min' | 'cost') => register(k, { valueAsNumber: true });
  return <form className="space-y-2" noValidate onSubmit={handleSubmit((v) => { const r = update((d) => { saveMaterial(d, v, today, m?.id); }, `Material ${m ? 'updated' : 'added'}: ${v.name}`, 'inventory:write'); if (r.ok) onDone(); else setErr(r.error); })}>
    <FormError m={err} />
    <Field label="Name" error={errors.name?.message}><input className={fieldCls} {...register('name')} /></Field>
    <Field label="Category" error={errors.cat?.message}><input className={fieldCls} {...register('cat')} /></Field>
    <Field label="Unit of measure" error={errors.unit?.message}><input className={fieldCls} list="units" {...register('unit')} /></Field><datalist id="units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
    <Field label="Supplier" error={errors.sup?.message}><input className={fieldCls} {...register('sup')} /></Field>
    {!m && <Field label="Opening quantity" error={errors.qty?.message}><input type="number" step="any" className={fieldCls} {...n('qty')} /></Field>}
    <Field label="Minimum stock" error={errors.min?.message}><input type="number" step="any" className={fieldCls} {...n('min')} /></Field>
    <Field label={`Unit cost (${db.cur})`} error={errors.cost?.message}><input type="number" step="0.01" className={fieldCls} {...n('cost')} /></Field>
    {m && <p className="text-xs text-slate-500">Change the quantity with “Adjust” so the movement history explains it.</p>}
    <FormActions onCancel={onDone} /></form>;
}
const moveSchema = z.object({ q: z.number({ invalid_type_error: 'Enter a quantity' }).positive('Quantity must be greater than 0'), p: z.number().optional() });
function MoveForm({ m, kind, onDone }: { m: Material; kind: 'in' | 'out'; onDone: () => void }) {
  const { db, today, update } = useData(), [err, setErr] = useState(''), [opId] = useState(newOpId);
  const projects = db.P.filter((p) => p.status !== 'Archived');
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof moveSchema>>({ resolver: zodResolver(moveSchema), defaultValues: { p: projects[0]?.id } });
  return <form className="space-y-2" noValidate onSubmit={handleSubmit((v) => { const r = update((d) => moveStock(d, { id: m.id, kind, qty: v.q, today, project: kind === 'out' ? v.p ?? null : null, opId }), `${kind === 'in' ? 'Received' : 'Consumed'} ${v.q} ${m.unit} ${m.name}`, 'inventory:write'); if (r.ok) onDone(); else setErr(r.error); })}>
    <FormError m={err} /><p className="text-sm text-slate-500">In stock: {m.qty} {m.unit}</p>
    <Field label={`Quantity (${m.unit})`} error={errors.q?.message}><input type="number" step="any" className={fieldCls} {...register('q', { valueAsNumber: true })} /></Field>
    {kind === 'out' && <Field label="Charge to project"><select className={fieldCls} {...register('p', { valueAsNumber: true })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
    <FormActions onCancel={onDone} /></form>;
}
const adjSchema = z.object({ counted: z.number({ invalid_type_error: 'Enter the counted quantity' }).min(0, 'Cannot be negative'), reason: z.string().min(3, 'Give a reason') });
function AdjustForm({ m, onDone }: { m: Material; onDone: () => void }) {
  const { today, update } = useData(), [err, setErr] = useState(''), [opId] = useState(newOpId);
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof adjSchema>>({ resolver: zodResolver(adjSchema), defaultValues: { counted: m.qty, reason: '' } });
  return <form className="space-y-2" noValidate onSubmit={handleSubmit((v) => { const r = update((d) => adjustStock(d, { id: m.id, counted: v.counted, reason: v.reason, today, opId }), `Stock adjusted: ${m.name}`, 'inventory:write'); if (r.ok) onDone(); else setErr(r.error); })}>
    <FormError m={err} /><p className="text-sm text-slate-500">System quantity: {m.qty} {m.unit}</p>
    <Field label={`Counted quantity (${m.unit})`} error={errors.counted?.message}><input type="number" step="any" className={fieldCls} {...register('counted', { valueAsNumber: true })} /></Field>
    <Field label="Reason" error={errors.reason?.message}><input className={fieldCls} {...register('reason')} /></Field><FormActions onCancel={onDone} /></form>;
}
const poSchema = z.object({ m: z.number(), p: z.number().optional(), q: z.number({ invalid_type_error: 'Enter a quantity' }).positive('Quantity must be greater than 0') });
function PoForm({ onDone }: { onDone: () => void }) {
  const { db, today, role, update } = useData(), [err, setErr] = useState(''), [opId] = useState(newOpId);
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof poSchema>>({ resolver: zodResolver(poSchema), defaultValues: { m: db.I[0]?.id, p: undefined } });
  return <form className="space-y-2" noValidate onSubmit={handleSubmit((v) => { const r = update((d) => createPurchaseRequest(d, { m: v.m, q: v.q, today, opId, p: v.p && !Number.isNaN(v.p) ? v.p : null, by: role }), 'Purchase request created', 'inventory:write'); if (r.ok) onDone(); else setErr(r.error); })}>
    <FormError m={err} />
    <Field label="Material"><select className={fieldCls} {...register('m', { valueAsNumber: true })}>{db.I.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
    <Field label="For project (optional)"><select className={fieldCls} {...register('p', { setValueAs: (x: string) => (x === '' ? undefined : Number(x)) })}><option value="">None</option>{db.P.filter((p) => p.status !== 'Archived').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    <Field label="Quantity" error={errors.q?.message}><input type="number" step="any" className={fieldCls} {...register('q', { valueAsNumber: true })} /></Field><FormActions onCancel={onDone} /></form>;
}
export default function Materials() {
  const { db, update, today, can, role } = useData(), [dlg, setDlg] = useState<Dlg>(null), [q, setQ] = useState(''), [lowOnly, setLowOnly] = useState(false), [mq, setMq] = useState(''), [err, setErr] = useState('');
  const w = can('inventory:write'), close = () => setDlg(null);
  const items = db.I.filter((m) => (!q || `${m.name} ${m.cat} ${m.sku} ${m.sup}`.toLowerCase().includes(q.toLowerCase())) && (!lowOnly || isLowStock(m)));
  const hist = db.MV.filter((x) => !mq || String(x[1]).toLowerCase().includes(mq.toLowerCase())).slice(0, 25);
  const openPo = (id: number) => db.PO.find((o) => o.m === id && PO_NEXT[o.status]);
  const run = (fn: () => ReturnType<typeof update>) => { const r = fn(); setErr(r.ok ? '' : r.error); };
  const title = dlg?.t === 'edit' ? (dlg.m ? `Edit ${dlg.m.name}` : 'Add material') : dlg?.t === 'po' ? 'Purchase request' : dlg?.t === 'adjust' ? `Adjust ${dlg.m.name}` : dlg?.t === 'move' ? `${dlg.kind === 'in' ? 'Receive' : 'Consume'} ${dlg.m.name}` : '';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Materials & Inventory</h1>
        <input type="search" aria-label="Search materials" placeholder="Search materials" value={q} onChange={(e) => setQ(e.target.value)} className={inlineField} />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />Low stock only</label>
        <Button variant="primary" disabled={!w} onClick={() => setDlg({ t: 'edit', m: null })}>+ Add material</Button></div>
      {err && <Notice tone="error" onClose={() => setErr('')}>{err}</Notice>}
      {!db.I.length ? <Empty title="No materials yet" hint="Add a material to start tracking stock." /> : <Card><Table head={['SKU', 'Material', 'Qty', 'Min', 'Unit cost', 'Value', 'Supplier', '']} empty="No materials match." rows={items.map((m) => [m.sku, m.name, <span key="q">{m.qty} {m.unit} {m.qty === 0 ? <Badge tone="bad">Out</Badge> : isLowStock(m) && <Badge tone="warn">Low</Badge>} {isLowStock(m) && openPo(m.id) && <Badge>Request #{openPo(m.id)?.id} open</Badge>}</span>, m.min, money(m.cost, db.cur), money(Math.round(m.qty * m.cost * 100) / 100, db.cur), m.sup,
        <span key="a" className="flex gap-1"><Button disabled={!w} onClick={() => setDlg({ t: 'move', m, kind: 'in' })}>Receive</Button><Button disabled={!w} onClick={() => setDlg({ t: 'move', m, kind: 'out' })}>Consume</Button><Button disabled={!w} onClick={() => setDlg({ t: 'adjust', m })}>Adjust</Button><Button disabled={!w} onClick={() => setDlg({ t: 'edit', m })}>Edit</Button></span>])} />
        <p className="mt-2 text-sm"><b>Inventory value:</b> {money(inventoryValue(db.I), db.cur)} (quantity × current unit cost)</p></Card>}
      <Card><div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="mr-auto font-medium">Stock movements</h2><input type="search" aria-label="Filter movements by material" placeholder="Filter by material" value={mq} onChange={(e) => setMq(e.target.value)} className={inlineField} /></div>
        <Table head={['Date', 'Material', 'Type', 'Qty', 'Project', 'Note']} empty="No movements recorded." rows={hist.map((x) => [String(x[0]), String(x[1]), String(x[2]), String(x[3]), db.P.find((p) => p.id === x[4])?.name ?? '—', String(x[5] ?? '')])} /><p className="mt-1 text-xs text-slate-500">Showing the latest 25 of {db.MV.length}.</p></Card>
      <Card><div className="mb-2 flex items-center"><h2 className="mr-auto font-medium">Purchase requests</h2><Button disabled={!w || !db.I.length} onClick={() => setDlg({ t: 'po' })}>+ New request</Button></div>
        <Table head={['#', 'Material', 'Project', 'Qty', 'Requested', 'Est. cost', 'Status', '']} empty="No purchase requests." rows={db.PO.map((o) => { const m = db.I.find((x) => x.id === o.m), nx = PO_NEXT[o.status]; return [o.id, m?.name ?? '—', db.P.find((p) => p.id === o.p)?.name ?? '—', o.q, o.date ?? '—', money(Math.round(o.q * (m?.cost ?? 0) * 100) / 100, db.cur), <Badge key="s" tone={o.status === 'Received' ? 'ok' : o.status === 'Cancelled' ? 'bad' : 'warn'}>{o.status}</Badge>,
          nx ? <span key="b" className="flex gap-1"><Button disabled={!w} onClick={() => run(() => update((d) => advancePurchaseOrder(d, o.id, today, { role, by: role }), `PO #${o.id} → ${nx}`, nx === 'Approved' ? 'purchase:approve' : 'inventory:write'))}>{nx === 'Received' ? 'Mark received' : nx === 'Approved' ? 'Approve' : `→ ${nx}`}</Button><Button variant="danger" disabled={!w} onClick={() => { if (window.confirm(`Cancel request #${o.id}?`)) run(() => update((d) => cancelPurchaseOrder(d, o.id), `PO #${o.id} cancelled`, 'inventory:write')); }}>Cancel</Button></span> : ''] })} />
        <p className="mt-2 text-xs text-slate-500">Marking a request received adds the quantity to stock once, and records it in the movement history. Estimated cost uses the current unit cost.</p></Card>
      {dlg && <Modal title={title} onClose={close}>{dlg.t === 'edit' ? <MaterialForm m={dlg.m} onDone={close} /> : dlg.t === 'po' ? <PoForm onDone={close} /> : dlg.t === 'adjust' ? <AdjustForm m={dlg.m} onDone={close} /> : <MoveForm m={dlg.m} kind={dlg.kind} onDone={close} />}</Modal>}
    </div>
  );
}
