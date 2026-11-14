import { afterEach, describe, expect, it, vi } from 'vitest';

import { type AutosaveRecord, defaultAutosave, memoryAutosave } from './autosave';
import { emptyDocument } from './document';

const record = (): AutosaveRecord => ({ doc: emptyDocument(), dirty: true, fileName: null, handle: null, savedAt: null });

describe('autosave stores', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the in-memory store keeps, returns and clears one record', async () => {
    const store = memoryAutosave();
    expect(await store.load()).toBeNull();
    const saved = record();
    await store.save(saved);
    expect(await store.load()).toBe(saved);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('without IndexedDB the default store still works, and says it does not persist', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const store = defaultAutosave();
    expect(store.persistent).toBe(false);
    await store.save(record());
    expect((await store.load())?.dirty).toBe(true);
  });

  it('with IndexedDB the default store is the persistent one', () => {
    vi.stubGlobal('indexedDB', {});
    expect(defaultAutosave().persistent).toBeUndefined();
  });
});
