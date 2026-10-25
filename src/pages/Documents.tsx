import { useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Badge, Card } from '../components/ui/card';
import { Empty, Notice } from '../components/ui/states';
import { Table } from '../components/ui/table';
import { useAuth } from '../components/AuthGate';
import { useData } from '../data/store';
import { ACCEPT, MAX_FILE_BYTES, deleteDocument, downloadDocument, previewKind, uploadDocument, type DocCtx } from '../lib/documents';
import { Modal } from '../components/ui/modal';
import { isSupabaseConfigured } from '../lib/supabase';
import { createStorage } from '../lib/storage';
import { canDeleteDocument, canViewDocument } from '../lib/permissions';
import { downloadBlob, fieldCls, inlineField } from '../lib/utils';
import { DOC_CATEGORIES } from '../types';
export default function Documents() {
  const { db, today, role, can, update, getDb } = useData(), { user } = useAuth(), uid = user?.id ?? null, who = user?.email ?? 'demo-user';
  const storage = useMemo(() => createStorage(uid), [uid]), inp = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState(''), [cat, setCat] = useState(DOC_CATEGORIES[0] as string), [fp, setFp] = useState(''), [fc, setFc] = useState(''), [q, setQ] = useState('');
  const [preview, setPreview] = useState<{ name: string; kind: 'image' | 'text'; url?: string; text?: string } | null>(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const projects = db.P.filter((p) => p.status !== 'Archived'), canUp = can('document:upload') && (!isSupabaseConfigured || !!uid);
  const ctx = (): DocCtx => ({ getDb, commit: (fn, act) => update(fn, act), storage, role, user: who, today });
  const fail = (e: unknown) => setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Something went wrong.' });
  const upload = async () => {
    if (busy) return;
    const f = inp.current?.files?.[0], p = Number(project || projects[0]?.id);
    if (!f) { setMsg({ tone: 'error', text: 'Choose a file first.' }); return; }
    setBusy(true); setMsg(null);
    try { const d = await uploadDocument(ctx(), f, p, cat); setMsg({ tone: 'info', text: `Uploaded “${d.n}”.` }); if (inp.current) inp.current.value = ''; } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const download = async (id: number) => { try { const r = await downloadDocument(ctx(), id); downloadBlob(r.blob, r.name); } catch (e) { fail(e); } };
  const closePreview = () => { if (preview?.url) URL.revokeObjectURL(preview.url); setPreview(null); };
  const show = async (id: number) => { const d = db.DOC.find((x) => x.id === id); const kind = d ? previewKind(d.type, d.n) : null; if (!d || !kind) return; try { const r = await downloadDocument(ctx(), id); setPreview(kind === 'image' ? { name: r.name, kind, url: URL.createObjectURL(r.blob) } : { name: r.name, kind, text: (await r.blob.slice(0, 100_000).text()) }); } catch (e) { fail(e); } };
  const remove = async (id: number, name: string) => { if (busy || !window.confirm(`Permanently delete “${name}”? This cannot be undone.`)) return; setBusy(true); try { const w = await deleteDocument(ctx(), id); setMsg(w ? { tone: 'error', text: w } : { tone: 'info', text: 'Document deleted.' }); } catch (e) { fail(e); } finally { setBusy(false); } };
  const list = db.DOC.filter((d) => canViewDocument(role, d.c) && (!fp || d.p === Number(fp)) && (!fc || d.c === fc) && (!q || d.n.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Documents</h1>
      <Notice tone="warn">{isSupabaseConfigured ? (uid ? 'Files are stored in your Supabase “documents” bucket. Document records are still kept in this browser until the database layer is connected.' : 'Sign in to upload files to Supabase storage.') : 'Local development mode: files are stored in this browser (IndexedDB) only. They are not uploaded to any server and are not shared between devices.'}</Notice>
      {msg && <Notice tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      <Card><h2 className="mb-2 font-medium">Upload</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="block text-sm">Project<select className={fieldCls} value={project} onChange={(e) => setProject(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="block text-sm">Category<select className={fieldCls} value={cat} onChange={(e) => setCat(e.target.value)}>{DOC_CATEGORIES.filter((c) => canViewDocument(role, c)).map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="block text-sm sm:col-span-2">File (max {MAX_FILE_BYTES / 1048576} MB)<input ref={inp} type="file" accept={ACCEPT} className={fieldCls} /></label></div>
        <div className="mt-2 flex items-center gap-2"><Button variant="primary" disabled={busy || !canUp || !projects.length} onClick={() => void upload()}>{busy ? 'Working…' : 'Upload'}</Button>{!can('document:upload') && <span className="text-xs text-slate-500">Your role cannot upload documents.</span>}</div>
        <p className="mt-1 text-xs text-slate-500">Allowed: {ACCEPT.replaceAll('.', '')}. Executables, scripts, HTML and SVG are rejected. A file already in the project (same content) is rejected as a duplicate.</p></Card>
      <Card><div className="mb-2 flex flex-wrap gap-2"><h2 className="mr-auto font-medium">Library</h2>
        <select aria-label="Filter by project" value={fp} onChange={(e) => setFp(e.target.value)} className={inlineField}><option value="">All projects</option>{db.P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Filter by category" value={fc} onChange={(e) => setFc(e.target.value)} className={inlineField}><option value="">All categories</option>{DOC_CATEGORIES.filter((c) => canViewDocument(role, c)).map((c) => <option key={c}>{c}</option>)}</select>
        <input type="search" aria-label="Search documents" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} className={inlineField} /></div>
        {!db.DOC.length ? <Empty title="No documents yet" hint="Upload a drawing, permit or report above." /> : <Table head={['Name', 'Project', 'Category', 'Size', 'Uploaded by', 'Added', 'Storage', '']} empty="No documents match." rows={list.map((d) => [d.n, db.P.find((p) => p.id === d.p)?.name ?? '—', d.c, `${Math.max(1, Math.ceil(d.s / 1024))} KB`, d.by ?? '—', d.d, d.provider === 'metadata-only' ? <Badge key="s" tone="warn">Name only</Badge> : <Badge key="s" tone="ok">{d.provider === 'supabase' ? 'Supabase' : 'This browser'}</Badge>,
          <span key="a" className="flex gap-1">{previewKind(d.type, d.n) && <Button onClick={() => void show(d.id)} aria-label={`Preview ${d.n}`}>Preview</Button>}<Button disabled={d.provider === 'metadata-only'} onClick={() => void download(d.id)} aria-label={`Download ${d.n}`}>Download</Button><Button variant="danger" disabled={busy || !canDeleteDocument(role, d.by, who)} onClick={() => void remove(d.id, d.n)} aria-label={`Delete ${d.n}`}>Delete</Button></span>])} />}
        <p className="mt-2 text-xs text-slate-500">Some categories (Invoices, Contracts) are hidden from roles without finance/procurement access. Role checks are enforced by the app in demo mode; they are not a security boundary until the backend is connected.</p></Card>
      {preview && <Modal wide title={`Preview: ${preview.name}`} onClose={closePreview}>{preview.kind === 'image' ? <img src={preview.url} alt={preview.name} className="max-h-[70vh] max-w-full" /> : <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-xs">{preview.text}</pre>}<div className="pt-3"><Button onClick={closePreview}>Close</Button></div></Modal>}
    </div>
  );
}
