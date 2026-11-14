/*
 * One working copy per tab.
 *
 * The app can be open in several tabs, each with its own tree. If they all wrote one autosave
 * record, the last tab to write would silently replace the others' work. So each tab owns a
 * "slot":
 *
 * - The slot id lives in `sessionStorage`, which belongs to the tab: it survives a reload and the
 *   browser restoring the tab, and no other tab sees it.
 * - While a tab is open it holds a Web Lock named after its slot. The browser frees the lock when
 *   the tab goes away, however it goes (closed, crashed, killed), so a slot whose lock is free
 *   belongs to nobody: it is "orphaned".
 *
 * On start a tab (1) takes back the slot named in its sessionStorage, when that slot still has a
 * document; otherwise (2) adopts the most recently changed orphaned slot, so opening the app again
 * brings back the tree that was open when it was last closed; otherwise (3) starts empty. A tab
 * opened next to a live one therefore starts empty (or with an older orphan), never with a copy
 * of the live tab's document and file handle.
 *
 * Orphans nobody adopts are kept up to MAX_ORPHANED_SLOTS; the oldest beyond that are deleted. A
 * slot whose tab is alive is never touched.
 *
 * Where the browser has no Web Locks (old browsers, pages not served over https), a heartbeat in
 * localStorage stands in for the lock: a tab that closes clears it, and one that crashed is
 * treated as gone once its heartbeat is HEARTBEAT_STALE_MS old.
 */
import type { AutosaveRecord, AutosaveStore } from './autosave';

/** A record as stored: the autosave record plus when it was last written. */
export type StoredSlot = AutosaveRecord & { modifiedAt: number };

/** Where slots are kept (IndexedDB in the app, memory in tests). */
export interface SlotBackend {
  list(): Promise<{ id: string; modifiedAt: number }[]>;
  get(id: string): Promise<StoredSlot | null>;
  put(id: string, slot: StoredSlot): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Tells live slots from orphaned ones. */
export interface SlotClaims {
  /**
   * Claims `id` for this tab until `release` or the tab going away. False when a live tab holds
   * it. `waitMs` gives a tab that is just closing (this one, before a reload) time to let go.
   */
  claim(id: string, waitMs?: number): Promise<boolean>;
  release(id: string): void;
}

/** The parts of the tab the slots need. */
export interface TabEnvironment {
  claims: SlotClaims;
  /** The slot id this tab used before a reload, if any. */
  remembered(): string | null;
  remember(id: string): void;
  newId(): string;
  /** Called when a slot is deleted, to drop whatever else is kept under its id. */
  forget(id: string): void;
  now(): number;
}

/** Orphaned slots kept for a later tab to adopt. */
export const MAX_ORPHANED_SLOTS = 5;
/** How long a reloading tab waits for its own previous page to release its slot. */
export const RELOAD_WAIT_MS = 1500;

export const SLOT_SESSION_KEY = 'ombuto-ost.slot';
const LOCK_PREFIX = 'ombuto-ost.slot.';
const HEARTBEAT_PREFIX = 'ombuto-ost.live.';
const HEARTBEAT_MS = 15_000;
/** Background tabs run timers as rarely as once a minute, so a live tab can be this quiet. */
export const HEARTBEAT_STALE_MS = 150_000;

/** localStorage key of the collapsed branches of the document in slot `id` (view state, never in the file). */
export const slotCollapsedKey = (id: string): string => `ombuto-ost.collapsed.${id}`;

/**
 * Autosave for one tab over a shared set of slots. Nothing is decided until the first call: `load`
 * (at start-up) picks the slot as described at the top of this file.
 */
export function slotAutosave(backend: SlotBackend, tab: TabEnvironment): AutosaveStore {
  let slotId: string | null = null;
  let starting: Promise<void> | null = null;

  async function fresh(): Promise<string> {
    const id = tab.newId();
    await tab.claims.claim(id);
    return id;
  }

  /** Deletes the oldest orphans beyond the number kept. `slots` is newest first. */
  async function prune(slots: { id: string }[]): Promise<void> {
    let orphans = 0;
    for (const { id } of slots) {
      if (id === slotId || !(await tab.claims.claim(id))) continue; // mine, or a live tab's
      try {
        if (++orphans > MAX_ORPHANED_SLOTS) {
          await backend.delete(id);
          tab.forget(id);
        }
      } finally {
        tab.claims.release(id);
      }
    }
  }

  async function start(): Promise<void> {
    const slots = (await backend.list()).sort((a, b) => b.modifiedAt - a.modifiedAt);
    const remembered = tab.remembered();
    // 1. This tab's own slot, after a reload or a restored tab. A duplicated tab remembers the
    //    same id as its original, which still holds the claim: it falls through and gets another.
    let own: string | null = null;
    if (remembered && (await tab.claims.claim(remembered, RELOAD_WAIT_MS))) own = remembered;
    if (own && slots.some(s => s.id === own)) {
      slotId = own;
    } else {
      // 2. The work a closed or crashed tab left behind, newest first.
      for (const { id } of slots) {
        if (id === own || !(await tab.claims.claim(id))) continue;
        slotId = id;
        break;
      }
      // 3. Nothing to bring back.
      if (slotId && own) tab.claims.release(own);
      slotId ??= own ?? (await fresh());
    }
    tab.remember(slotId);
    // Housekeeping must never stop the app from starting.
    await prune(slots).catch(() => {});
  }

  const ready = (): Promise<void> => {
    starting ??= start().catch(err => {
      starting = null;
      throw err;
    });
    return starting;
  };

  return {
    async load() {
      await ready();
      const slot = slotId ? await backend.get(slotId) : null;
      if (!slot) return null;
      const record: Partial<StoredSlot> = { ...slot };
      delete record.modifiedAt;
      return record as AutosaveRecord;
    },
    async save(record) {
      await ready();
      await backend.put(slotId!, { ...record, modifiedAt: tab.now() });
    },
    async clear() {
      await ready();
      await backend.delete(slotId!);
    },
    slotId: () => slotId,
    async setAside() {
      await ready();
      const aside = slotId!;
      slotId = await fresh();
      tab.remember(slotId);
      tab.claims.release(aside);
      return aside;
    },
    async discard(id) {
      if (id === slotId || !(await tab.claims.claim(id))) return;
      try {
        await backend.delete(id);
        tab.forget(id);
      } finally {
        tab.claims.release(id);
      }
    },
  };
}

// ---- in memory (tests) ----------------------------------------------------------------------------

export function memorySlots(initial: Record<string, StoredSlot> = {}): SlotBackend & { slots: Map<string, StoredSlot> } {
  const slots = new Map(Object.entries(initial));
  return {
    slots,
    list: async () => [...slots].map(([id, slot]) => ({ id, modifiedAt: slot.modifiedAt })),
    get: async id => slots.get(id) ?? null,
    put: async (id, slot) => void slots.set(id, slot),
    delete: async id => void slots.delete(id),
  };
}

// ---- the browser ------------------------------------------------------------------------------------

/** Claims held as Web Locks: the browser itself frees them when the tab goes away. */
export function webLockClaims(locks: LockManager): SlotClaims {
  const held = new Map<string, () => void>();
  return {
    claim(id, waitMs = 0) {
      if (held.has(id)) return Promise.resolve(true);
      return new Promise<boolean>(resolve => {
        const controller = waitMs > 0 ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), waitMs) : undefined;
        locks
          .request(LOCK_PREFIX + id, controller ? { signal: controller.signal } : { ifAvailable: true }, lock => {
            clearTimeout(timer);
            if (!lock) return resolve(false);
            resolve(true);
            // Held until release(): the lock lasts as long as this promise is pending.
            return new Promise<void>(release => held.set(id, release));
          })
          .catch(() => resolve(false));
      });
    },
    release(id) {
      held.get(id)?.();
      held.delete(id);
    },
  };
}

/**
 * Claims without Web Locks: a heartbeat per slot in localStorage. Not airtight (two tabs starting
 * in the same instant can both win), but a tab that is open keeps its slot and a closed one frees it.
 */
export function heartbeatClaims(storage: Storage, now: () => number = Date.now): SlotClaims {
  const token = Math.random().toString(36).slice(2);
  const mine = new Set<string>();
  const beat = (id: string) => storage.setItem(HEARTBEAT_PREFIX + id, JSON.stringify({ token, at: now() }));
  const drop = (id: string) => {
    try {
      storage.removeItem(HEARTBEAT_PREFIX + id);
    } catch {
      // storage gone: the heartbeat goes stale by itself
    }
  };
  const read = (id: string): { token: string; at: number } | null => {
    try {
      const value: unknown = JSON.parse(storage.getItem(HEARTBEAT_PREFIX + id) ?? 'null');
      const beatValue = value as { token?: unknown; at?: unknown } | null;
      return beatValue && typeof beatValue.token === 'string' && typeof beatValue.at === 'number'
        ? { token: beatValue.token, at: beatValue.at }
        : null;
    } catch {
      return null;
    }
  };
  let timer: ReturnType<typeof setInterval> | null = null;
  const listen = () => {
    if (timer !== null) return;
    timer = setInterval(() => {
      try {
        for (const id of mine) beat(id);
      } catch {
        // storage full or blocked: nothing more to do
      }
    }, HEARTBEAT_MS);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => mine.forEach(drop));
  };
  return {
    async claim(id) {
      try {
        const other = read(id);
        if (other && other.token !== token && now() - other.at < HEARTBEAT_STALE_MS) return false;
        beat(id);
        if (read(id)?.token !== token) return false;
      } catch {
        // No working storage: there is nothing to tell tabs apart with, so behave as the only tab.
      }
      mine.add(id);
      listen();
      return true;
    },
    release(id) {
      if (mine.delete(id)) drop(id);
    },
  };
}

const safeStorage = (name: 'sessionStorage' | 'localStorage'): Storage | null => {
  try {
    return globalThis[name] ?? null;
  } catch {
    return null; // blocked by the browser's privacy settings
  }
};

/** The real tab: sessionStorage for the slot id, Web Locks (or the heartbeat) for the claims. */
export function browserTab(): TabEnvironment {
  const session = safeStorage('sessionStorage');
  const local = safeStorage('localStorage');
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  // Without sessionStorage a reload cannot know its slot: it adopts it back as the newest orphan.
  let fallbackId: string | null = null;
  const lone: SlotClaims = { claim: async () => true, release: () => {} };
  return {
    claims: locks ? webLockClaims(locks) : local ? heartbeatClaims(local) : lone,
    remembered() {
      try {
        return session?.getItem(SLOT_SESSION_KEY) ?? fallbackId;
      } catch {
        return fallbackId;
      }
    },
    remember(id) {
      fallbackId = id;
      try {
        session?.setItem(SLOT_SESSION_KEY, id);
      } catch {
        // storage full or blocked: see fallbackId
      }
    },
    newId: () =>
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    forget(id) {
      try {
        local?.removeItem(slotCollapsedKey(id));
      } catch {
        // nothing to clean up
      }
    },
    now: () => Date.now(),
  };
}
