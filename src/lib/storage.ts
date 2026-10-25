import type { SupabaseClient } from '@supabase/supabase-js';
import { MemoryDocumentStorage, type DocumentStorage } from './documents';
import { supabase } from './supabase';
const DB_NAME = 'buildspace-files', STORE = 'files';
/** Local development mode: real file bytes kept in this browser's IndexedDB. Not shared between devices and not cloud storage. */
export class IndexedDbDocumentStorage implements DocumentStorage {
  readonly kind = 'local' as const; private conn: Promise<IDBDatabase> | null = null;
  private open(): Promise<IDBDatabase> {
    this.conn ??= new Promise((res, rej) => { const r = indexedDB.open(DB_NAME, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(new Error('Local file storage is unavailable')); });
    return this.conn;
  }
  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((res, rej) => { const tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE)); tx.oncomplete = () => res(req.result); tx.onerror = () => rej(new Error('Local file storage failed (is the disk full?)')); tx.onabort = () => rej(new Error('Local file storage failed')); });
  }
  async put(path: string, file: Blob): Promise<void> { await this.run('readwrite', (s) => s.add(file, path)); }
  async get(path: string): Promise<Blob | null> { return ((await this.run('readonly', (s) => s.get(path))) as Blob | undefined) ?? null; }
  async remove(path: string): Promise<void> { await this.run('readwrite', (s) => s.delete(path)); }
}
/** Cloud mode (requires VITE_SUPABASE_* and a signed-in user). Objects live under `<userId>/…`; see supabase/migrations/002. UNTESTED against a live project. */
export class SupabaseDocumentStorage implements DocumentStorage {
  readonly kind = 'supabase' as const;
  constructor(private client: SupabaseClient, private bucket: string, private prefix: string) {}
  private key(path: string) { return `${this.prefix}/${path}`; }
  async put(path: string, file: Blob, contentType: string): Promise<void> { const { error } = await this.client.storage.from(this.bucket).upload(this.key(path), file, { contentType, upsert: false }); if (error) throw new Error('Upload failed. Check your connection and permissions.'); }
  async get(path: string): Promise<Blob | null> { const { data, error } = await this.client.storage.from(this.bucket).download(this.key(path)); return error ? null : data; }
  async remove(path: string): Promise<void> { const { error } = await this.client.storage.from(this.bucket).remove([this.key(path)]); if (error) throw new Error('Could not remove the stored file'); }
}
export function createStorage(userId?: string | null): DocumentStorage {
  if (supabase && userId) return new SupabaseDocumentStorage(supabase, 'documents', userId);
  if (typeof indexedDB !== 'undefined') return new IndexedDbDocumentStorage();
  return new MemoryDocumentStorage();
}
