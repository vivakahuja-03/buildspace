import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DB, Role } from '../types';
import { seed } from './seed';
import { todayIso } from '../lib/dates';
import { DomainError, type Result } from '../lib/errors';
import { STORAGE_KEY, loadDb, normalizeDb, serializeDb } from '../lib/persistence';
import { asRole, can, type Action } from '../lib/permissions';
interface Ctx {
  db: DB; today: string; role: Role; can: (a: Action) => boolean; issues: string[]; notice: string; storageError: string; dismissNotice: () => void;
  /** Runs `fn` on a copy of the latest data. Commits only if it does not throw; returns the outcome (never throws). */
  update: (fn: (d: DB) => void, activity?: string, perm?: Action) => Result;
  getDb: () => DB; reset: () => Result; replace: (db: DB, activity: string) => Result;
}
const C = createContext<Ctx | null>(null);
/** Newest copy in storage when another tab has saved since we last did (prevents stale tabs overwriting newer data). */
function freshest(current: DB): DB {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return current; const s = normalizeDb(JSON.parse(raw)).db; return (s.rev ?? 0) > (current.rev ?? 0) ? s : current; } catch { return current; }
}
export function DataProvider({ children }: { children: ReactNode }) {
  const [init] = useState(() => { try { return loadDb(localStorage); } catch { return { db: seed(), issues: [] as string[], notice: 'Browser storage is unavailable. Changes will not be saved.' }; } });
  const [db, setDb] = useState<DB>(init.db), [issues, setIssues] = useState(init.issues), [notice, setNotice] = useState(init.notice), [storageError, setErr] = useState(''), [today, setToday] = useState(todayIso);
  const ref = useRef(db);
  const commit = useCallback((n: DB) => { ref.current = n; setDb(n); }, []);
  useEffect(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY), stored = raw ? normalizeDb(JSON.parse(raw)).db : null; if (stored && (stored.rev ?? 0) > (db.rev ?? 0)) { commit(stored); return; } localStorage.setItem(STORAGE_KEY, serializeDb(db)); setErr(''); }
    catch { setErr('Could not save to browser storage. Changes will be lost when you close this tab.'); }
  }, [db, commit]);
  useEffect(() => { const on = (e: StorageEvent) => { if (e.key !== STORAGE_KEY || !e.newValue) return; try { const n = normalizeDb(JSON.parse(e.newValue)).db; if ((n.rev ?? 0) > (ref.current.rev ?? 0)) commit(n); } catch { /* ignore foreign data */ } }; window.addEventListener('storage', on); return () => window.removeEventListener('storage', on); }, [commit]);
  useEffect(() => { const t = setInterval(() => setToday(todayIso()), 60_000); return () => clearInterval(t); }, []);
  const update = useCallback<Ctx['update']>((fn, activity, perm) => {
    const base = freshest(ref.current), role = asRole(base.role);
    if (perm && !can(role, perm)) return { ok: false, error: `Your role (${role}) is not allowed to do this.` };
    const next = structuredClone(base);
    try { fn(next); } catch (e) { if (e instanceof DomainError) return { ok: false, error: e.message }; console.error('BuildSpace: unexpected error', e instanceof Error ? e.name : 'unknown'); return { ok: false, error: 'Something went wrong. Your data was not changed.' }; }
    next.rev = (base.rev ?? 0) + 1;
    if (activity) next.act = [[activity, todayIso()] as [string, string], ...next.act].slice(0, 40);
    commit(next); return { ok: true };
  }, [commit]);
  const replace = useCallback<Ctx['replace']>((n, activity) => { const base = freshest(ref.current), next = { ...n, rev: (base.rev ?? 0) + 1, act: [[activity, todayIso()] as [string, string], ...n.act].slice(0, 40) }; commit(next); setIssues([]); return { ok: true }; }, [commit]);
  const reset = useCallback(() => update((d) => { Object.assign(d, { ...seed(), role: d.role }); d.rev = d.rev ?? 0; }, 'Demo data restored', 'settings:reset'), [update]);
  const role = asRole(db.role);
  const value = useMemo<Ctx>(() => ({ db, today, role, can: (a) => can(role, a), issues, notice, storageError, dismissNotice: () => setNotice(''), update, getDb: () => ref.current, reset, replace }), [db, today, role, issues, notice, storageError, update, reset, replace]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useData(): Ctx { const c = useContext(C); if (!c) throw new Error('useData outside DataProvider'); return c; }
