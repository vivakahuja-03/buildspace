import { DOC_CATEGORIES, type DB, type Doc, type Role } from '../types';
import { canDeleteDocument, canViewDocument, can } from './permissions';
import { DomainError, type Result } from './errors';
import { nextId } from './ids';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Extension -> acceptable MIME types ('' = browser did not report one). SVG/HTML/scripts are deliberately excluded. */
export const ALLOWED: Record<string, string[]> = {
  pdf: ['application/pdf'], png: ['image/png'], jpg: ['image/jpeg'], jpeg: ['image/jpeg'], webp: ['image/webp'],
  txt: ['text/plain'], csv: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  doc: ['application/msword'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['application/vnd.ms-powerpoint'], pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  dwg: ['application/acad', 'application/x-acad', 'application/octet-stream', 'image/vnd.dwg'], dxf: ['application/dxf', 'application/octet-stream', 'image/vnd.dxf', 'text/plain'],
};
export const ACCEPT = Object.keys(ALLOWED).map((e) => `.${e}`).join(',');
export interface DocumentStorage { readonly kind: 'local' | 'supabase' | 'memory'; put(path: string, file: Blob, contentType: string): Promise<void>; get(path: string): Promise<Blob | null>; remove(path: string): Promise<void> }
/** In-memory provider: used by tests and as a non-persistent fallback when IndexedDB is unavailable. */
export class MemoryDocumentStorage implements DocumentStorage {
  readonly kind = 'memory' as const; readonly files = new Map<string, Blob>();
  async put(path: string, file: Blob): Promise<void> { if (this.files.has(path)) throw new Error('File already exists'); this.files.set(path, file); }
  async get(path: string): Promise<Blob | null> { return this.files.get(path) ?? null; }
  async remove(path: string): Promise<void> { this.files.delete(path); }
}
/** Strips path parts and control characters; throws if nothing usable remains. */
export function sanitizeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (!base || base.length > 150) throw new DomainError('File name is empty or longer than 150 characters');
  return base;
}
export const extensionOf = (name: string): string => (/\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? '').toLowerCase();
export function validateFile(f: { name: string; size: number; type: string }): string {
  const name = sanitizeFileName(f.name), ext = extensionOf(name);
  if (!ALLOWED[ext]) throw new DomainError(`File type ".${ext || '?'}" is not allowed. Allowed: ${Object.keys(ALLOWED).join(', ')}`);
  if (!(f.size > 0)) throw new DomainError('The file is empty');
  if (f.size > MAX_FILE_BYTES) throw new DomainError('The file is larger than 10 MB');
  if (f.type && !(ALLOWED[ext] as string[]).includes(f.type)) throw new DomainError(`The file content type (${f.type}) does not match its .${ext} extension`);
  return name;
}
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer(), h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Domain operations on the store; `commit` runs a transaction on the database. */
export interface DocCtx { getDb(): DB; commit(fn: (d: DB) => void, activity?: string): Result; storage: DocumentStorage; role: Role; user: string; today: string }
export async function uploadDocument(ctx: DocCtx, file: File, project: number, category: string): Promise<Doc> {
  if (!can(ctx.role, 'document:upload')) throw new DomainError(`Your role (${ctx.role}) cannot upload documents`);
  const name = validateFile(file), db = ctx.getDb(), p = db.P.find((x) => x.id === project);
  if (!p || p.status === 'Archived') throw new DomainError('Choose an active project');
  if (!(DOC_CATEGORIES as readonly string[]).includes(category)) throw new DomainError('Choose a valid category');
  if (!canViewDocument(ctx.role, category)) throw new DomainError(`Your role (${ctx.role}) cannot add ${category} documents`);
  const hash = await sha256Hex(file), dup = db.DOC.find((x) => x.p === project && x.hash === hash);
  if (dup) throw new DomainError(`This file was already uploaded to the project as "${dup.n}"`);
  const id = nextId(db.DOC), path = `${project}/${id}-${name.replace(/[^A-Za-z0-9._-]/g, '_')}`;
  const doc: Doc = { id, n: name, s: file.size, p: project, c: category, d: ctx.today, type: file.type || 'application/octet-stream', by: ctx.user, path, hash, provider: ctx.storage.kind === 'supabase' ? 'supabase' : 'local' };
  await ctx.storage.put(path, file, doc.type ?? 'application/octet-stream');
  const r = ctx.commit((d) => {
    if (d.DOC.some((x) => x.p === project && x.hash === hash)) throw new DomainError('This file was already uploaded to the project');
    d.DOC.unshift({ ...doc, id: nextId(d.DOC) });
  }, `Document uploaded: ${name}`);
  if (!r.ok) { try { await ctx.storage.remove(path); } catch { /* orphan is harmless */ } throw new DomainError(r.error); }
  return doc;
}
export async function downloadDocument(ctx: DocCtx, id: number): Promise<{ blob: Blob; name: string }> {
  const doc = ctx.getDb().DOC.find((x) => x.id === id);
  if (!doc) throw new DomainError('Document not found');
  if (!canViewDocument(ctx.role, doc.c)) throw new DomainError(`Your role (${ctx.role}) cannot access ${doc.c} documents`);
  if (!doc.path || doc.provider === 'metadata-only') throw new DomainError('Only the name of this document was recorded; no file was stored.');
  const blob = await ctx.storage.get(doc.path);
  if (!blob) throw new DomainError('The file is missing from storage');
  return { blob, name: doc.n };
}
/** Removes the record first (so nothing points at a missing file), then the stored file. */
export async function deleteDocument(ctx: DocCtx, id: number): Promise<string> {
  const doc = ctx.getDb().DOC.find((x) => x.id === id);
  if (!doc) throw new DomainError('Document not found');
  if (!canViewDocument(ctx.role, doc.c) || !canDeleteDocument(ctx.role, doc.by, ctx.user)) throw new DomainError(`Your role (${ctx.role}) cannot delete this document`);
  const r = ctx.commit((d) => { d.DOC = d.DOC.filter((x) => x.id !== id); }, `Document deleted: ${doc.n}`);
  if (!r.ok) throw new DomainError(r.error);
  if (doc.path && doc.provider !== 'metadata-only') { try { await ctx.storage.remove(doc.path); } catch { return 'The record was deleted but the stored file could not be removed.'; } }
  return '';
}

/** Only images and plain text are previewed in-page; everything else is download-only (no HTML/PDF rendering of untrusted files). */
export const previewKind = (type: string | undefined, name: string): 'image' | 'text' | null => {
  const ext = extensionOf(name);
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext) && (type ?? '').startsWith('image/')) return 'image';
  if (['txt', 'csv'].includes(ext)) return 'text';
  return null;
};
