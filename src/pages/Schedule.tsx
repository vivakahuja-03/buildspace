import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TaskForm } from './Tasks';
import { Button } from '../components/ui/button';
import { Badge, Card } from '../components/ui/card';
import { FormError } from '../components/ui/field';
import { Modal } from '../components/ui/modal';
import { Empty, Notice } from '../components/ui/states';
import { Table } from '../components/ui/table';
import { useData } from '../data/store';
import { isOverdue, taskCompletion } from '../lib/calc';
import { addDays } from '../lib/dates';
import { buildTimeline, rescheduleTask, scheduleConflicts } from '../lib/schedule';
import { fieldCls, inlineField } from '../lib/utils';
import type { Phase, Task } from '../types';
const ROW = 32, LABEL = 176, HEAD = 48, ZOOM: Record<string, number> = { Day: 28, Week: 12, Month: 4 };
const COLOR: Record<string, string> = { Completed: 'bg-green-600', 'In Progress': 'bg-sky-600', Blocked: 'bg-amber-500', 'To Do': 'bg-slate-400', Backlog: 'bg-slate-300', Cancelled: 'bg-slate-200' };
function DateForm({ t, onDone }: { t: Task; onDone: () => void }) {
  const { update } = useData(), [start, setStart] = useState(t.start), [due, setDue] = useState(t.due), [cascade, setCascade] = useState(true), [err, setErr] = useState('');
  const shift = (n: number) => { setStart(addDays(start, n)); setDue(addDays(due, n)); };
  const save = () => { const r = update((d) => { rescheduleTask(d, t.id, start, due, cascade); }, `Task rescheduled: ${t.title}`, 'task:write'); if (r.ok) onDone(); else setErr(r.error); };
  return <div className="space-y-2"><FormError m={err} /><p className="text-sm text-slate-500">{t.title}</p>
    <div className="grid grid-cols-2 gap-2"><label className="block text-sm">Start<input type="date" className={fieldCls} value={start} onChange={(e) => setStart(e.target.value)} /></label><label className="block text-sm">Due<input type="date" className={fieldCls} value={due} onChange={(e) => setDue(e.target.value)} /></label></div>
    <div className="flex gap-2"><Button onClick={() => shift(-7)}>−1 week</Button><Button onClick={() => shift(-1)}>−1 day</Button><Button onClick={() => shift(1)}>+1 day</Button><Button onClick={() => shift(7)}>+1 week</Button></div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />Shift dependent tasks so they still start after this one ends</label>
    <div className="flex gap-2 pt-2"><Button variant="primary" onClick={save}>Save dates</Button><Button onClick={onDone}>Cancel</Button></div></div>;
}
export default function Schedule() {
  const { db, today, can } = useData(), [sp, setSp] = useSearchParams(), project = sp.get('project') ?? '', [zoom, setZoom] = useState('Week'), [hideDone, setHideDone] = useState(false), [edit, setEdit] = useState<Task | null>(null), [full, setFull] = useState<Task | 'new' | null>(null);
  const box = useRef<HTMLDivElement>(null), px = ZOOM[zoom] ?? 12, w = can('task:write');
  const all = db.T.filter((t) => db.P.some((p) => p.id === t.p && p.status !== 'Archived') && (!project || t.p === Number(project)));
  const tasks = all.filter((t) => !hideDone || (t.status !== 'Completed' && t.status !== 'Cancelled')).sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
  const tl = useMemo(() => buildTimeline(tasks, today, px), [tasks, today, px]);
  const conflicts = scheduleConflicts(all, db.P), cmap = new Map<number, string[]>();
  conflicts.forEach((c) => cmap.set(c.task, [...(cmap.get(c.task) ?? []), c.message]));
  const goToday = () => box.current?.scrollTo({ left: Math.max(0, LABEL + tl.x(today) - (box.current?.clientWidth ?? 600) / 2), behavior: 'smooth' });
  useEffect(() => { goToday(); /* eslint-disable-next-line */ }, [zoom, project]);
  const by = (n: number) => box.current?.scrollBy({ left: n * px * 7, behavior: 'smooth' });
  type Row = { k: 'phase'; ph: Phase } | { k: 'task'; t: Task };
  const proj = project ? db.P.find((p) => p.id === Number(project)) : undefined, phases = proj?.phases ?? [], rows: Row[] = [];
  for (const ph of phases) { rows.push({ k: 'phase', ph }); tasks.filter((t) => t.phase === ph.id).forEach((t) => rows.push({ k: 'task', t })); }
  tasks.filter((t) => !phases.some((ph) => ph.id === t.phase)).forEach((t) => rows.push({ k: 'task', t }));
  const idx = new Map(rows.flatMap((r, i) => (r.k === 'task' ? [[r.t.id, i] as [number, number]] : [])));
  const arrows = tasks.flatMap((t) => { const pi = t.dep === '' ? undefined : idx.get(t.dep), pre = pi === undefined ? undefined : tasks.find((x) => x.id === t.dep); if (pi === undefined || !pre) return []; const x1 = tl.x(pre.due) + px, x2 = tl.x(t.start), y1 = pi * ROW + ROW / 2, y2 = (idx.get(t.id) ?? 0) * ROW + ROW / 2, bad = t.start < pre.due; return [{ key: t.id, bad, d: `M${x1} ${y1} H${x1 + 6} V${y2} H${Math.max(x2, 0)}` }]; });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Schedule</h1>
        <select aria-label="Project" value={project} onChange={(e) => setSp(e.target.value ? { project: e.target.value } : {})} className={inlineField}><option value="">All projects</option>{db.P.filter((p) => p.status !== 'Archived').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Zoom" value={zoom} onChange={(e) => setZoom(e.target.value)} className={inlineField}>{Object.keys(ZOOM).map((z) => <option key={z}>{z}</option>)}</select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />Hide finished</label>
        <Button variant="primary" disabled={!w} onClick={() => setFull('new')}>+ Task</Button><Button onClick={() => by(-4)} aria-label="Scroll back 4 weeks">◀ 4 wks</Button><Button onClick={goToday}>Today</Button><Button onClick={() => by(4)} aria-label="Scroll forward 4 weeks">4 wks ▶</Button></div>
      {!w && <Notice>Your role can view the schedule but not change dates.</Notice>}
      {!tasks.length ? <Empty title="No tasks to schedule" hint={hideDone && all.length ? 'All tasks are finished. Untick “Hide finished”.' : 'Create tasks on the Tasks page and they will appear here.'} /> : (
        <Card className="!p-0"><div ref={box} className="overflow-x-auto" tabIndex={0} aria-label="Timeline, scrolls horizontally">
          <div className="relative" style={{ width: LABEL + tl.width }}>
            <div className="flex border-b border-slate-200 dark:border-slate-700" style={{ height: HEAD }}><div className="sticky left-0 z-10 shrink-0 bg-white p-2 text-xs font-medium dark:bg-slate-800" style={{ width: LABEL }}>Task</div>
              <div className="relative" style={{ width: tl.width }}>{tl.months.map((m) => <div key={m.x} className="absolute top-0 truncate border-l border-slate-200 px-1 text-xs font-medium dark:border-slate-700" style={{ left: m.x, width: m.w }}>{m.w >= 40 ? m.label : ''}</div>)}{tl.ticks.map((k) => <div key={k.x} className="absolute bottom-0 border-l border-slate-200 pl-0.5 text-[10px] text-slate-500 dark:border-slate-700" style={{ left: k.x }}>{k.label}</div>)}</div></div>
            {rows.map((row) => { if (row.k === 'phase') { const pb = tl.bar({ start: row.ph.start, due: row.ph.end }); return <div key={`ph${row.ph.id}`} className="flex border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-900" style={{ height: ROW }}><div className="sticky left-0 z-10 flex shrink-0 items-center truncate bg-slate-50 px-2 text-xs font-semibold dark:bg-slate-900" style={{ width: LABEL }}>▸ {row.ph.name}</div><div className="relative" style={{ width: tl.width }}><div className="absolute rounded bg-slate-700" title={`${row.ph.name}: ${row.ph.start} → ${row.ph.end}`} style={{ left: pb.left, width: pb.width, top: ROW / 2 - 3, height: 6 }} /></div></div>; } const t = row.t, b = tl.bar(t), late = isOverdue(t, today), cs = cmap.get(t.id); return (
              <div key={t.id} className="flex border-b border-slate-100 dark:border-slate-800" style={{ height: ROW }}>
                <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1 truncate bg-white px-2 text-xs dark:bg-slate-800" style={{ width: LABEL }} title={t.title}><span className="truncate">{t.title}</span>{cs && <span role="img" aria-label={`Scheduling issue: ${cs.join('; ')}`} title={cs.join('\n')}>⚠️</span>}</div>
                <div className="relative" style={{ width: tl.width }}>
                  <button type="button" disabled={!w || t.status === 'Completed'} onClick={() => setEdit(t)} aria-label={`${t.title}, ${t.start} to ${t.due}, ${t.status}, ${taskCompletion(t)}% done${late ? ', overdue' : ''}. ${w ? 'Edit dates' : ''}`} title={`${t.title}\n${t.start} → ${t.due}\n${t.status} · ${taskCompletion(t)}%`}
                    className={`absolute top-1.5 overflow-hidden rounded text-left focus-visible:outline focus-visible:outline-2 ${t.ms ? 'rotate-45' : ''} ${late ? 'ring-2 ring-red-600' : ''} ${COLOR[t.status] ?? 'bg-slate-400'}`} style={t.ms ? { left: b.left + b.width - 10, width: 16, height: 16, top: 8 } : { left: b.left, width: Math.max(b.width, 6), height: ROW - 12 }}>
                    {!t.ms && <span className="absolute inset-y-0 left-0 bg-black/25" style={{ width: `${taskCompletion(t)}%` }} />}</button></div></div>); })}
            <svg aria-hidden="true" className="pointer-events-none absolute" style={{ left: LABEL, top: HEAD, width: tl.width, height: rows.length * ROW }}>{arrows.map((a) => <path key={a.key} d={a.d} fill="none" stroke={a.bad ? '#dc2626' : '#2b7de9'} strokeWidth={1.5} />)}</svg>
            {today >= tl.lo && today <= tl.hi && <div aria-hidden="true" className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-blue-600" style={{ left: LABEL + tl.x(today) }} />}
          </div></div></Card>)}
      <p className="text-xs text-slate-500">Bar = task (darker part = completed share). Red ring = overdue. Diamond = milestone. Blue line = today. Arrows = “starts after” links (red when the link is violated). Select a bar to change its dates.</p>
      {conflicts.length > 0 && <Card><h2 className="mb-2 font-medium">Scheduling conflicts ({conflicts.length})</h2><Table head={['Task', 'Type', 'Issue']} rows={conflicts.map((c) => [db.T.find((t) => t.id === c.task)?.title ?? '—', <Badge key="b" tone={c.severity === 'error' ? 'bad' : 'warn'}>{c.kind === 'dependency' ? 'Dependency' : c.kind === 'assignee' ? 'Double-booked' : c.kind === 'outside-project' ? 'Outside project' : 'Invalid dates'}</Badge>, c.message])} /></Card>}
      {edit && <Modal title="Change task dates" onClose={() => setEdit(null)}><DateForm t={edit} onDone={() => setEdit(null)} /><div className="border-t pt-2 text-sm"><Button disabled={!w} onClick={() => { setFull(edit); setEdit(null); }}>Edit all task details…</Button></div></Modal>}
      {full && <Modal title={full === 'new' ? 'New task' : 'Edit task'} onClose={() => setFull(null)}><TaskForm editing={full === 'new' ? null : full} defaultProject={project ? Number(project) : ''} onDone={() => setFull(null)} /></Modal>}
    </div>
  );
}
