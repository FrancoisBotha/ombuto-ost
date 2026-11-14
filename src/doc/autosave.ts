/*
 * Autosave of the working document in the browser's own IndexedDB, so a reload, a closed tab or a
 * crash does not lose the tree. This is storage on this device only: IndexedDB is never synced or
 * sent anywhere.
 *
 * Every tab has its own working copy (a "slot", see autosave-slots.ts): two tabs of the app never
 * write over each other. The file handle is stored with the document where the browser allows
 * handles to be stored; otherwise the next Save simply asks where to save.
 */
import { type SlotBackend, type StoredSlot, browserTab, slotAutosave } from './autosave-slots';
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
  /**
   * How that save reached the computer: written to a file the user chose, or handed to the
   * browser's downloads (which the app cannot see the outcome of). Absent in older records.
   */
  savedBy?: 'file' | 'download' | null;
  /** The file behind `handle` as this tab last saw it on disk (file-access `fileStamp`). */
  fileStamp?: string | null;
}

export interface AutosaveStore {
  /** False when nothing written here outlives the tab (no browser storage): autosave is then off. */
  persistent?: boolean;
  /** This tab's working copy: its own from before a reload, else one a closed tab left behind, else null. */
  load(): Promise<AutosaveRecord | null>;
  save(record: AutosaveRecord): Promise<void>;
  clear(): Promise<void>;
  // The rest is optional: a store with one record and no tabs to tell apart (tests) leaves it out.
  /** Names this tab's working copy (view state of the document is kept under it); null when there is none. */
  slotId?(): string | null;
  /**
   * Leaves the working copy just loaded where it is, untouched, and gives this tab a fresh one to
   * write to. For a copy that cannot be read: it must not be overwritten by whatever comes next.
   * Resolves to the id of the copy set aside (for `discard`), or null.
   */
  setAside?(): Promise<string | null>;
  /** Deletes a working copy that was set aside. Only ever called on the user's say-so. */
  discard?(id: string): Promise<void>;
}

const DB_NAME = 'ombuto-ost';
const DB_VERSION = 2;
/** One record per tab, keyed by slot id. */
const SLOTS = 'slots';
/** Version 1 kept a single record for the whole browser, under one key. */
const LEGACY_STORE = 'working-document';
const LEGACY_KEY = 'current';
/** The slot the version 1 record moves to: the first tab to start adopts it like any closed tab's work. */
export const MIGRATED_SLOT_ID = 'migrated';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const slots = db.createObjectStore(SLOTS);
      if (!db.objectStoreNames.contains(LEGACY_STORE)) return;
      // Carry the one working document of version 1 over, so an update of the app loses nothing.
      const legacy = request.transaction!.objectStore(LEGACY_STORE).get(LEGACY_KEY);
      legacy.onsuccess = () => {
        const record: unknown = legacy.result;
        if (record && typeof record === 'object') slots.put({ ...record, modifiedAt: Date.now() }, MIGRATED_SLOT_ID);
        db.deleteObjectStore(LEGACY_STORE);
      };
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('The browser storage is busy.'));
  });
}

/** The slots in IndexedDB. */
export function indexedDbSlots(): SlotBackend {
  // One connection for the life of the tab: a write started while the page is closing then needs
  // no round trip to open the database first, and so has the best chance of landing.
  let connection: Promise<IDBDatabase> | null = null;
  const connect = (): Promise<IDBDatabase> => {
    connection ??= openDb().then(
      db => {
        const forget = () => {
          connection = null;
        };
        // A newer version of the app wants to change the database: let it.
        db.onversionchange = () => {
          db.close();
          forget();
        };
        db.onclose = forget;
        return db;
      },
      err => {
        connection = null;
        throw err;
      },
    );
    return connection;
  };

  async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await connect();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(SLOTS, mode);
      const request = action(tx.objectStore(SLOTS));
      // Commit now instead of when the request's result has come back to this page: a write made
      // while the page is closing would otherwise be dropped with the page.
      if (mode === 'readwrite') tx.commit?.();
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.onabort = () => reject(tx.error ?? request.error);
    });
  }

  return {
    async list() {
      const db = await connect();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(SLOTS, 'readonly');
        const keys = tx.objectStore(SLOTS).getAllKeys();
        const values = tx.objectStore(SLOTS).getAll() as IDBRequest<Partial<StoredSlot>[]>;
        tx.oncomplete = () =>
          resolve(
            keys.result.map((key, i) => {
              const modifiedAt = values.result[i]?.modifiedAt;
              return { id: String(key), modifiedAt: typeof modifiedAt === 'number' ? modifiedAt : 0 };
            }),
          );
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    async get(id) {
      return (await run<StoredSlot | undefined>('readonly', store => store.get(id))) ?? null;
    },
    async put(id, slot) {
      try {
        await run('readwrite', store => store.put(slot, id));
      } catch (err) {
        // Some browsers cannot store a file handle: keep the document, drop the handle.
        if (!slot.handle) throw err;
        await run('readwrite', store => store.put({ ...slot, handle: null }, id));
      }
    },
    async delete(id) {
      await run('readwrite', store => store.delete(id));
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
    slotId: () => null,
    setAside: async () => {
      current = null;
      return null;
    },
    discard: async () => {},
  };
}

/** IndexedDB when the browser has it (it can be missing or blocked in private windows). */
export const defaultAutosave = (): AutosaveStore =>
  typeof indexedDB === 'undefined' ? { ...memoryAutosave(), persistent: false } : slotAutosave(indexedDbSlots(), browserTab());
