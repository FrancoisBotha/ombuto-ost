import { describe, expect, it } from 'vitest';

import type { AutosaveRecord } from './autosave';
import {
  HEARTBEAT_STALE_MS,
  MAX_ORPHANED_SLOTS,
  type SlotClaims,
  type StoredSlot,
  type TabEnvironment,
  heartbeatClaims,
  memorySlots,
  slotAutosave,
} from './autosave-slots';
import { emptyDocument } from './document';

const record = (name: string, dirty = true): AutosaveRecord => ({
  doc: emptyDocument(name),
  dirty,
  fileName: null,
  handle: null,
  savedAt: null,
});
const stored = (name: string, modifiedAt: number): StoredSlot => ({ ...record(name), modifiedAt });

/** One browser: the slots every tab shares, and which tab holds which slot (what Web Locks do). */
function browser(initial: Record<string, StoredSlot> = {}) {
  const backend = memorySlots(initial);
  const holders = new Map<string, object>();
  const forgotten: string[] = [];
  let clock = 1_000_000;
  let ids = 0;

  function openTab(session: { slot: string | null } = { slot: null }) {
    const me = {};
    const claims: SlotClaims = {
      async claim(id) {
        const holder = holders.get(id);
        if (holder && holder !== me) return false;
        holders.set(id, me);
        return true;
      },
      release(id) {
        if (holders.get(id) === me) holders.delete(id);
      },
    };
    const tab: TabEnvironment = {
      claims,
      remembered: () => session.slot,
      remember: id => void (session.slot = id),
      newId: () => `slot-${++ids}`,
      forget: id => void forgotten.push(id),
      now: () => ++clock,
    };
    return {
      store: slotAutosave(backend, tab),
      session,
      /** The tab goes away, however it goes: the browser frees its claims. */
      close() {
        for (const [id, holder] of holders) if (holder === me) holders.delete(id);
      },
    };
  }
  return { backend, openTab, forgotten };
}

const nameOf = (r: AutosaveRecord | null) => r?.doc.name ?? null;

describe('one working copy per tab', () => {
  it('two tabs never write over each other (the reported loss: A edits, B opens, New tree, A crashes)', async () => {
    const b = browser();
    const tabA = b.openTab();
    expect(await tabA.store.load()).toBeNull();
    await tabA.store.save(record('Tree of tab A'));

    // Tab B opens the app while A is alive: it starts empty, it does not get A's document.
    const tabB = b.openTab();
    expect(await tabB.store.load()).toBeNull();
    await tabB.store.save(record('New tree in tab B', false));
    expect(tabB.store.slotId!()).not.toBe(tabA.store.slotId!());

    // A crashes and the app is opened again: A's tree is still there.
    tabA.close();
    const again = b.openTab();
    expect(nameOf(await again.store.load())).toBe('Tree of tab A');
    // B still has its own.
    expect(nameOf(await tabB.store.load())).toBe('New tree in tab B');
  });

  it('a reload takes the tab back to its own slot, even when another closed tab changed something later', async () => {
    const b = browser();
    const tabA = b.openTab();
    await tabA.store.load();
    await tabA.store.save(record('A'));
    const other = b.openTab();
    await other.store.load();
    await other.store.save(record('Other, newer'));
    other.close();
    tabA.close(); // the old page of the reload
    const reloaded = b.openTab(tabA.session); // same sessionStorage
    expect(nameOf(await reloaded.store.load())).toBe('A');
  });

  it('opening the app again adopts the most recently changed slot a closed tab left behind', async () => {
    const b = browser({ old: stored('Older', 10), recent: stored('Most recent', 20) });
    const tab = b.openTab();
    expect(nameOf(await tab.store.load())).toBe('Most recent');
    expect(tab.store.slotId!()).toBe('recent');
    // A second tab next to it gets the other orphan, never a copy of the first tab's.
    const second = b.openTab();
    expect(nameOf(await second.store.load())).toBe('Older');
    const third = b.openTab();
    expect(await third.store.load()).toBeNull();
  });

  it('a duplicated tab (same remembered slot as its live original) gets a slot of its own', async () => {
    const b = browser();
    const original = b.openTab();
    await original.store.load();
    await original.store.save(record('Original'));
    const duplicate = b.openTab({ slot: original.session.slot });
    expect(await duplicate.store.load()).toBeNull();
    await duplicate.store.save(record('Duplicate'));
    expect(nameOf(await original.store.load())).toBe('Original');
    expect(duplicate.session.slot).not.toBe(original.session.slot);
  });

  it('a tab that reloads in the empty state picks up a closed tab’s work', async () => {
    const b = browser();
    const empty = b.openTab();
    expect(await empty.store.load()).toBeNull(); // remembers a slot, but never wrote to it
    const worker = b.openTab();
    await worker.store.load();
    await worker.store.save(record('Left behind'));
    worker.close();
    empty.close();
    const reloaded = b.openTab(empty.session);
    expect(nameOf(await reloaded.store.load())).toBe('Left behind');
  });

  it('keeps a bounded number of orphaned slots, deletes the oldest, and never a live tab’s', async () => {
    const b = browser();
    const live = b.openTab();
    await live.store.load();
    await live.store.save(record('Live and old')); // older than every orphan below
    const orphans = Object.fromEntries(
      Array.from({ length: MAX_ORPHANED_SLOTS + 4 }, (_, i) => [`o${i}`, stored(`Orphan ${i}`, 2_000_000 + i)]),
    );
    for (const [id, slot] of Object.entries(orphans)) await b.backend.put(id, slot);

    const tab = b.openTab();
    expect(nameOf(await tab.store.load())).toBe(`Orphan ${MAX_ORPHANED_SLOTS + 3}`); // the newest
    const left = [...b.backend.slots.keys()].sort();
    // The live tab's slot, the adopted one, and MAX_ORPHANED_SLOTS orphans: the three oldest are gone.
    expect(left).toHaveLength(MAX_ORPHANED_SLOTS + 2);
    expect(left).toContain(live.store.slotId!());
    expect(left).not.toContain('o0');
    expect(left).not.toContain('o2');
    expect(left).toContain('o3');
    expect(b.forgotten.sort()).toEqual(['o0', 'o1', 'o2']);
    // The kept orphans can still be adopted.
    const next = b.openTab();
    expect(nameOf(await next.store.load())).toBe(`Orphan ${MAX_ORPHANED_SLOTS + 2}`);
  });

  it('setAside leaves an unreadable copy untouched and gives the tab a fresh slot; discard deletes it only then', async () => {
    const b = browser({ damaged: stored('Damaged', 5) });
    const tab = b.openTab();
    await tab.store.load();
    const aside = await tab.store.setAside!();
    expect(aside).toBe('damaged');
    await tab.store.save(record('New work'));
    expect(b.backend.slots.get('damaged')?.doc.name).toBe('Damaged');
    expect(tab.store.slotId!()).not.toBe('damaged');
    await tab.store.discard!('damaged');
    expect(b.backend.slots.has('damaged')).toBe(false);
    expect(b.forgotten).toEqual(['damaged']);
  });

  it('discard never deletes a slot a live tab holds', async () => {
    const b = browser();
    const tabA = b.openTab();
    await tabA.store.load();
    await tabA.store.save(record('A'));
    const tabB = b.openTab();
    await tabB.store.load();
    await tabB.store.discard!(tabA.store.slotId!()!);
    expect(nameOf(await tabA.store.load())).toBe('A');
  });

  it('clear removes only this tab’s record', async () => {
    const b = browser();
    const tab = b.openTab();
    await tab.store.save(record('Mine'));
    await b.backend.put('other', stored('Other', 1));
    await tab.store.clear();
    expect(await tab.store.load()).toBeNull();
    expect(b.backend.slots.has('other')).toBe(true);
  });
});

describe('claims without Web Locks (heartbeat)', () => {
  function storage(): Storage {
    const items = new Map<string, string>();
    return {
      get length() {
        return items.size;
      },
      clear: () => items.clear(),
      getItem: key => items.get(key) ?? null,
      key: index => [...items.keys()][index] ?? null,
      removeItem: key => void items.delete(key),
      setItem: (key, value) => void items.set(key, String(value)),
    };
  }

  it('a live tab keeps its slot; releasing it, or going quiet for long enough, frees it', async () => {
    const shared = storage();
    let now = 1000;
    const tabA = heartbeatClaims(shared, () => now);
    const tabB = heartbeatClaims(shared, () => now);
    expect(await tabA.claim('s')).toBe(true);
    expect(await tabA.claim('s')).toBe(true); // its own
    expect(await tabB.claim('s')).toBe(false);
    tabA.release('s');
    expect(await tabB.claim('s')).toBe(true);
    // B crashed (no release): A gets the slot once B's heartbeat is stale.
    now += HEARTBEAT_STALE_MS - 1;
    expect(await tabA.claim('s')).toBe(false);
    now += 2;
    expect(await tabA.claim('s')).toBe(true);
  });

  it('with storage that throws it behaves as the only tab instead of failing', async () => {
    const broken = storage();
    broken.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    expect(await heartbeatClaims(broken).claim('s')).toBe(true);
  });
});
