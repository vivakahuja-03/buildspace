import { describe, expect, it } from 'vitest';
import { MemoryDocumentStorage, deleteDocument, downloadDocument, sanitizeFileName, uploadDocument, validateFile, MAX_FILE_BYTES, type DocCtx } from './documents';
import { freshDb, TODAY_T } from './fixtures';
import { DomainError } from './errors';
import type { DB, Role } from '../types';
const mk = (role: Role = 'Project Manager', user = 'Tester') => {
  let db: DB = freshDb(); const storage = new MemoryDocumentStorage();
  const ctx = (): DocCtx => ({ getDb: () => db, storage, role, user, today: TODAY_T, commit: (fn, act) => { try { const n = structuredClone(db); fn(n); if (act) n.act.unshift([act, TODAY_T]); db = n; return { ok: true as const }; } catch (e) { return { ok: false as const, error: (e as Error).message }; } } });
  return { ctx, storage, get db() { return db; } };
};
const file = (name: string, body = 'hello', type = 'application/pdf') => new File([body], name, { type });
describe('document validation', () => {
  it('sanitizes names', () => { expect(sanitizeFileName('C:\\x\\..\\plan?.pdf')).toBe('plan.pdf'); expect(sanitizeFileName('../../etc/passwd.txt')).toBe('passwd.txt'); expect(() => sanitizeFileName('   ')).toThrow(); expect(() => sanitizeFileName('a'.repeat(200))).toThrow(); });
  it('allows only listed types and matching content types', () => {
    expect(validateFile({ name: 'a.pdf', size: 10, type: 'application/pdf' })).toBe('a.pdf');
    for (const bad of ['a.exe', 'a.svg', 'a.html', 'a.js', 'noext', 'a.pdf.exe']) expect(() => validateFile({ name: bad, size: 10, type: '' })).toThrow(/not allowed/);
    expect(() => validateFile({ name: 'a.pdf', size: 10, type: 'text/html' })).toThrow(/does not match/);
  });
  it('enforces size limits', () => { expect(() => validateFile({ name: 'a.pdf', size: 0, type: '' })).toThrow(/empty/); expect(() => validateFile({ name: 'a.pdf', size: MAX_FILE_BYTES + 1, type: '' })).toThrow(/10 MB/); expect(validateFile({ name: 'a.pdf', size: MAX_FILE_BYTES, type: '' })).toBe('a.pdf'); });
});
describe('document workflows', () => {
  it('uploads the real bytes, stores metadata, and downloads them back', async () => {
    const h = mk(), d = await uploadDocument(h.ctx(), file('plan.pdf', 'PDFDATA'), 1, 'Engineering plans');
    expect([d.n, d.p, d.c, d.by, d.provider, d.s]).toEqual(['plan.pdf', 1, 'Engineering plans', 'Tester', 'local', 7]);
    expect(h.storage.files.size).toBe(1); const got = await downloadDocument(h.ctx(), d.id); expect(await got.blob.text()).toBe('PDFDATA'); expect(got.name).toBe('plan.pdf');
  });
  it('rejects duplicate content in the same project but allows it in another', async () => { const h = mk(); await uploadDocument(h.ctx(), file('a.pdf', 'same'), 1, 'Permits'); await expect(uploadDocument(h.ctx(), file('b.pdf', 'same'), 1, 'Permits')).rejects.toThrow(/already uploaded/); await uploadDocument(h.ctx(), file('b.pdf', 'same'), 2, 'Permits'); expect(h.db.DOC).toHaveLength(2); expect(h.storage.files.size).toBe(2); });
  it('rejects bad projects, categories and types without storing anything', async () => { const h = mk(); await expect(uploadDocument(h.ctx(), file('a.pdf'), 99, 'Permits')).rejects.toThrow(/project/); await expect(uploadDocument(h.ctx(), file('a.pdf'), 1, 'Nope')).rejects.toThrow(/category/); await expect(uploadDocument(h.ctx(), file('a.exe', 'x', ''), 1, 'Permits')).rejects.toThrow(/not allowed/); expect(h.storage.files.size).toBe(0); expect(h.db.DOC).toHaveLength(0); });
  it('rolls the stored file back when the metadata commit fails', async () => { const h = mk(); const c = h.ctx(); c.commit = () => ({ ok: false, error: 'boom' }); await expect(uploadDocument(c, file('a.pdf'), 1, 'Permits')).rejects.toThrow(/boom/); expect(h.storage.files.size).toBe(0); });
  it('access control: upload, restricted categories, delete', async () => {
    const pm = mk('Project Manager', 'Pat'); const d = await uploadDocument(pm.ctx(), file('inv.pdf', 'i'), 1, 'Invoices');
    const member = { ...pm.ctx(), role: 'Team Member' as Role, user: 'Tom' }; await expect(uploadDocument(member, file('x.pdf', 'x'), 1, 'Permits')).rejects.toThrow(/cannot upload/);
    const sup = { ...pm.ctx(), role: 'Site Supervisor' as Role, user: 'Sam' }; await expect(downloadDocument(sup, d.id)).rejects.toThrow(/cannot access/); await expect(uploadDocument(sup, file('y.pdf', 'y'), 1, 'Invoices')).rejects.toThrow(/cannot add/);
    const own = await uploadDocument(sup, file('site.png', 's', 'image/png'), 1, 'Site photographs'); await expect(deleteDocument({ ...sup, user: 'Other' }, own.id)).rejects.toThrow(/cannot delete/);
    expect(await deleteDocument(sup, own.id)).toBe(''); expect(pm.db.DOC.some((x) => x.id === own.id)).toBe(false);
  });
  it('delete removes record and file; missing/legacy documents fail safely', async () => {
    const h = mk(); const d = await uploadDocument(h.ctx(), file('a.pdf', 'q'), 1, 'Permits'); await deleteDocument(h.ctx(), d.id); expect(h.storage.files.size).toBe(0); expect(h.db.DOC).toHaveLength(0);
    await expect(deleteDocument(h.ctx(), 12345)).rejects.toThrow(/not found/);
    const legacy = mk(); legacy.db.DOC.push({ id: 1, n: 'old.pdf', s: 1, p: 1, c: 'Permits', d: TODAY_T, provider: 'metadata-only' }); await expect(downloadDocument(legacy.ctx(), 1)).rejects.toThrow(/no file was stored/);
  });
  it('errors are DomainErrors with safe messages', async () => { const h = mk(); try { await uploadDocument(h.ctx(), file('a.exe', 'x', ''), 1, 'Permits'); } catch (e) { expect(e instanceof DomainError).toBe(true); } });
});
