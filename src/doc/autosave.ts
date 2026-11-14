/*
 * Autosave of the working document in the browser's own IndexedDB, so a refresh or a crash loses
 * nothing. This is storage on this device only: IndexedDB is never synced or sent anywhere.
 *
 * One record is kept (the current document). The file handle is stored with it where the browser
 * allows handles to be stored; otherwise the next Save simply asks where to save.
 */
import type { OstDocument } from './document';

export interface AutosaveRecord {
  doc: OstDocument;
  /** Changes not yet saved to a file. */
  dirty: boolean;
  /** Name of the file this document was opened from or last saved to, when known. */
  fileName: string | null;
  handle: FileSystemFileHandle | null;
  /** ISO time of the last save to a file in this browser, when known. */
  savedAt: string | null;
}

export interface AutosaveStore {
  /** False when nothing written here outlives the tab (no browser storage): autosave is then off. */
  persistent?: boolean;
  load(): Promise<AutosaveRecord | null>;
  save(record: AutosaveRecord): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = 'ombuto-ost';
const STORE = 'working-document';
const KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('The browser storage is busy.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.onabort = () => reject(tx.error ?? request.error);
    });
  } finally {
    db.close();
  }
}

/** Autosave backed by IndexedDB. */
export function indexedDbAutosave(): AutosaveStore {
  return {
    async load() {
      const record = await withStore<AutosaveRecord | undefined>('readonly', store => store.get(KEY));
      return record ?? null;
    },
    async save(record) {
      try {
        await withStore('readwrite', store => store.put(record, KEY));
      } catch (err) {
        // Some browsers cannot store a file handle: keep the document, drop the handle.
        if (!record.handle) throw err;
        await withStore('readwrite', store => store.put({ ...record, handle: null }, KEY));
      }
    },
    async clear() {
      await withStore('readwrite', store => store.delete(KEY));
    },
  };
}

/** Autosave that keeps the record in memory only (tests, and browsers without IndexedDB). */
export function memoryAutosave(initial: AutosaveRecord | null = null): AutosaveStore {
  let current = initial;
  return {
    load: async () => current,
    save: async record => {
      current = record;
    },
    clear: async () => {
      current = null;
    },
  };
}

/** IndexedDB when the browser has it (it can be missing or blocked in private windows). */
export const defaultAutosave = (): AutosaveStore =>
  typeof indexedDB === 'undefined' ? { ...memoryAutosave(), persistent: false } : indexedDbAutosave();
