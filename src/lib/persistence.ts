import { PROJECT_STATUSES, TASK_STATUSES, type DB } from '../types';
import { clampPct } from './calc';
import { DomainError } from './errors';
import { seed } from '../data/seed';
export const STORAGE_KEY = 'buildspace-v1'; // same key and shape as the legacy app
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v.filter(isObj) as unknown as T[]) : []);
const num = (v: unknown, issues: string[], what: string): number => { if (typeof v === 'number' && Number.isFinite(v)) return v; issues.push(`${what} had an invalid number and was reset to 0`); return 0; };
/** Validates and repairs arbitrary data into a DB. Returns what it had to fix; throws DomainError if it is not BuildSpace data at all. */
export function normalizeDb(raw: unknown): { db: DB; issues: string[] } {
  if (!isObj(raw)) throw new DomainError('This is not BuildSpace data');
  if (!Array.isArray(raw.P) || !Array.isArray(raw.T)) throw new DomainError('This is not BuildSpace data (projects/tasks missing)');
  const issues: string[] = [], base = seed();
  const db: DB = {
    cur: typeof raw.cur === 'string' && raw.cur ? raw.cur : base.cur, act: Array.isArray(raw.act) ? (raw.act as unknown[]).filter((a): a is [string, string] => Array.isArray(a) && typeof a[0] === 'string').slice(0, 40) : [],
    rev: typeof raw.rev === 'number' ? raw.rev : 0, ops: Array.isArray(raw.ops) ? (raw.ops as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    P: arr(raw.P), T: arr(raw.T), M: arr(raw.M), I: arr(raw.I), E: arr(raw.E), MV: Array.isArray(raw.MV) ? (raw.MV as unknown[]).filter(Array.isArray) as DB['MV'] : [], DOC: arr(raw.DOC), PO: arr(raw.PO),
  };
  if (typeof raw.role === 'string') db.role = raw.role;
  db.P.forEach((p) => { p.budget = num(p.budget, issues, `Budget of "${p.name}"`); if (!PROJECT_STATUSES.includes(p.status)) { issues.push(`Project "${p.name}" had an unknown status; set to Planning`); p.status = 'Planning'; } });
  const taskIds = new Set(db.T.map((t) => t.id));
  db.T.forEach((t) => {
    if (!TASK_STATUSES.includes(t.status)) { issues.push(`Task "${t.title}" had an unknown status; set to To Do`); t.status = 'To Do'; }
    const fixed = clampPct(t.pct); if (fixed !== t.pct) issues.push(`Task "${t.title}" had an invalid completion value; set to ${fixed}%`); t.pct = fixed;
    if (t.dep !== '' && (!taskIds.has(t.dep as number) || t.dep === t.id)) { issues.push(`Task "${t.title}" pointed at a missing dependency; link removed`); t.dep = ''; }
  });
  db.I.forEach((m) => { for (const [k, label] of [['qty', 'Quantity'], ['cost', 'Unit cost'], ['min', 'Minimum']] as const) { const v = num(m[k], issues, `${label} of "${m.name}"`); if (v < 0) issues.push(`${label} of "${m.name}" was negative and was reset to 0`); m[k] = Math.max(0, v); } });
  db.E.forEach((x) => { x.amt = Math.abs(num(x.amt, issues, `Expense ${x.ref}`)); });
  let nid = Math.max(0, ...db.DOC.map((x) => (typeof x.id === 'number' ? x.id : 0)));
  db.DOC.forEach((x) => { if (typeof x.id !== 'number') x.id = ++nid; if (!x.provider) x.provider = x.path ? 'local' : 'metadata-only'; });
  return { db, issues };
}
export interface LoadResult { db: DB; issues: string[]; notice: string }
/** Reads stored data. Corrupt data is copied to a backup key before demo data is loaded, so nothing is silently destroyed. */
export function loadDb(storage: Pick<Storage, 'getItem' | 'setItem'>, now = Date.now()): LoadResult {
  let raw: string | null = null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return { db: seed(), issues: [], notice: 'Browser storage is unavailable. Changes will not be saved.' }; }
  if (!raw) return { db: seed(), issues: [], notice: '' };
  try { const { db, issues } = normalizeDb(JSON.parse(raw)); return { db, issues, notice: '' }; }
  catch {
    const key = `${STORAGE_KEY}-corrupt-${now}`; let saved = false;
    try { storage.setItem(key, raw); saved = true; } catch { /* quota */ }
    return { db: seed(), issues: [], notice: saved ? `Saved data could not be read. A copy was kept under "${key}" and demo data was loaded.` : 'Saved data could not be read and demo data was loaded.' };
  }
}
export const serializeDb = (db: DB): string => JSON.stringify(db);
export const exportBackup = (db: DB): string => JSON.stringify({ app: 'buildspace', version: 1, exportedAt: new Date().toISOString(), data: db }, null, 2);
export function importBackup(text: string): { db: DB; issues: string[] } {
  if (text.length > 20e6) throw new DomainError('Backup file is too large');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new DomainError('The file is not valid JSON'); }
  if (!isObj(parsed) || parsed.app !== 'buildspace' || !('data' in parsed)) throw new DomainError('This is not a BuildSpace backup file');
  return normalizeDb(parsed.data);
}
