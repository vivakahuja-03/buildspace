import { useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Notice } from '../components/ui/states';
import { useAuth } from '../components/AuthGate';
import { useData } from '../data/store';
import { DomainError } from '../lib/errors';
import { exportBackup, importBackup } from '../lib/persistence';
import { isSupabaseConfigured } from '../lib/supabase';
import { downloadBlob, fieldCls } from '../lib/utils';
import { ROLES } from '../types';
export default function Settings() {
  const { db, role, can, update, reset, replace, issues } = useData(), { user, signOut } = useAuth(), file = useRef<HTMLInputElement>(null), [msg, setMsg] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const out = (r: { ok: boolean; error?: string }, ok: string) => setMsg(r.ok ? { tone: 'info', text: ok } : { tone: 'error', text: r.error ?? 'Failed' });
  const doImport = async () => {
    const f = file.current?.files?.[0];
    if (!f) { setMsg({ tone: 'error', text: 'Choose a backup file first.' }); return; }
    try { const { db: n, issues: iss } = importBackup(await f.text()); if (!window.confirm(`Replace ALL current data with this backup (${n.P.length} projects, ${n.T.length} tasks)? Export a backup of the current data first if unsure.`)) return; try { localStorage.setItem(`buildspace-v1-before-import-${Date.now()}`, JSON.stringify(db)); } catch { /* storage full: continue, the user confirmed */ } replace(n, 'Backup imported'); setMsg({ tone: 'info', text: `Backup imported${iss.length ? ` (${iss.length} value(s) repaired)` : ''}.` }); if (file.current) file.current.value = ''; }
    catch (e) { setMsg({ tone: 'error', text: e instanceof DomainError ? e.message : 'Could not read the backup file.' }); }
  };
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Settings</h1>
      {msg && <Notice tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      <Card className="space-y-3"><h2 className="font-medium">Preferences</h2>
        <label className="block max-w-xs text-sm">Demo role<select className={fieldCls} value={role} onChange={(e) => out(update((d) => { d.role = e.target.value; }, `Demo role set to ${e.target.value}`), 'Role changed.')}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
        <p className="text-xs text-slate-500">Changes which actions the app allows (e.g. only Finance/Admin/PM may edit expenses). Anyone can switch it here, so it is a demo of the permission rules, not a security boundary. Real enforcement needs the Supabase backend and its row-level security.</p>
        <label className="block max-w-xs text-sm">Currency label<select className={fieldCls} value={db.cur} onChange={(e) => out(update((d) => { d.cur = e.target.value; }, `Currency label set to ${e.target.value}`), 'Currency label changed.')}>{['PKR', 'USD', 'EUR', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select></label>
        <p className="text-xs text-slate-500">Changes the label only; amounts are not converted.</p></Card>
      <Card className="space-y-2"><h2 className="font-medium">Storage & account</h2>
        <p className="text-sm">Business data: <b>this browser (localStorage)</b>. Documents: <b>{isSupabaseConfigured ? 'Supabase bucket when signed in' : 'this browser (IndexedDB)'}</b>. Supabase: <b>{isSupabaseConfigured ? 'configured (sign-in required)' : 'not configured (demo mode)'}</b>.</p>
        {isSupabaseConfigured && <p className="text-xs text-amber-800">The database layer is not connected yet, so projects, tasks, expenses and inventory are NOT synced to Supabase.</p>}
        {user && <p className="text-sm">Signed in as {user.email} <Button onClick={() => void signOut()}>Sign out</Button></p>}</Card>
      <Card className="space-y-2"><h2 className="font-medium">Backup & recovery</h2>
        <div className="flex flex-wrap gap-2"><Button onClick={() => downloadBlob(new Blob([exportBackup(db)], { type: 'application/json' }), `buildspace-backup-${new Date().toISOString().slice(0, 10)}.json`)}>Export backup (JSON)</Button></div>
        <div className="flex flex-wrap items-center gap-2"><input ref={file} type="file" accept="application/json,.json" aria-label="Backup file to import" className="text-sm" /><Button onClick={() => void doImport()}>Import backup</Button></div>
        <p className="text-xs text-slate-500">Import validates the file, keeps a safety copy of your current data in this browser, and repairs invalid values before replacing it. Uploaded document files are not part of the JSON backup.</p></Card>
      <Card className="space-y-2"><h2 className="font-medium">Data check</h2>{issues.length ? <><p className="text-sm">These problems were repaired when your saved data was loaded:</p><ul className="list-disc pl-5 text-sm">{issues.slice(0, 20).map((i, k) => <li key={k}>{i}</li>)}</ul></> : <p className="text-sm text-slate-500">No problems found in the saved data.</p>}</Card>
      <Card className="space-y-2"><h2 className="font-medium">Reset</h2><Button variant="danger" disabled={!can('settings:reset')} onClick={() => { if (window.confirm('Replace ALL data with the demo seed? Export a backup first if you need it.')) out(reset(), 'Demo data restored.'); }}>Reset demo data</Button>{!can('settings:reset') && <p className="text-xs text-slate-500">Only an Administrator can reset data.</p>}</Card>
    </div>
  );
}
