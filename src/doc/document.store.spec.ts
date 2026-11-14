import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPinia, setActivePinia } from 'pinia';

import { useOstTreeStore } from '@/ost/stores/ost-tree.store';
import { COLLAPSED_STORAGE_KEY, useOstUiStore } from '@/ost/stores/ost-ui.store';

import { type AutosaveRecord, type AutosaveStore, memoryAutosave } from './autosave';
import { parseDocument, serializeDocument } from './document';
import { AUTOSAVE_DELAY_MS, useDocumentStore } from './document.store';
import * as files from './file-access';
import { sampleDocument } from './sample';

vi.mock(import('./file-access'), async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    supportsFileHandles: vi.fn(() => false),
    pickFileToOpen: vi.fn(),
    pickFileToSave: vi.fn(),
    writeToHandle: vi.fn(),
    downloadFile: vi.fn(),
  };
});

const io = vi.mocked(files);

/** A stand-in for a file handle: the store only ever passes it on. */
const fakeHandle = (name: string) => ({ name, kind: 'file' }) as unknown as FileSystemFileHandle;

const sampleText = () => serializeDocument(sampleDocument(new Date('2026-01-02T03:04:05Z')));

/** Autosave that records what was written. */
function spyAutosave(initial: AutosaveRecord | null = null) {
  const inner = memoryAutosave(initial);
  const saves: AutosaveRecord[] = [];
  const store: AutosaveStore = {
    load: () => inner.load(),
    save: async record => {
      saves.push(record);
      await inner.save(record);
    },
    clear: () => inner.clear(),
  };
  return { store, saves, current: () => inner.load() };
}

describe('document store', () => {
  let doc: ReturnType<typeof useDocumentStore>;
  let tree: ReturnType<typeof useOstTreeStore>;
  let autosave: ReturnType<typeof spyAutosave>;

  function setup(initial: AutosaveRecord | null = null) {
    setActivePinia(createPinia());
    autosave = spyAutosave(initial);
    doc = useDocumentStore();
    tree = useOstTreeStore();
    doc.setAutosaveStore(autosave.store);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    io.supportsFileHandles.mockReturnValue(false);
    localStorage.clear();
    setup();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start-up', () => {
    it('starts with no document when nothing was autosaved', async () => {
      expect(doc.ready).toBe(false);
      await doc.init();
      expect(doc.ready).toBe(true);
      expect(doc.hasDocument).toBe(false);
      expect(tree.loaded).toBe(false);
    });

    it('restores the autosaved document with its name, file, dirty flag and collapsed branches', async () => {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify({ 'opportunity-3': true, 'gone-99': true }));
      setup({ doc: sampleDocument(), dirty: true, fileName: 'meals.ost', handle: null, savedAt: '2026-01-01T10:00:00.000Z' });
      await doc.init();
      expect(doc.hasDocument).toBe(true);
      expect(doc.name).toBe('Example: meal-planning app');
      expect(doc.dirty).toBe(true);
      expect(doc.fileName).toBe('meals.ost');
      expect(doc.lastSavedAt).toBe('2026-01-01T10:00:00.000Z');
      expect(tree.loaded).toBe(true);
      expect(tree.products).toHaveLength(1);
      // Collapsed branches come back; entries for nodes that no longer exist are dropped.
      expect(useOstUiStore().collapsed).toEqual({ 'opportunity-3': true });
      // Restoring is not a change: nothing is written back.
      expect(autosave.saves).toHaveLength(0);
    });

    it('validates what it restores: a damaged autosave leaves the empty state, not a broken app', async () => {
      setup({
        doc: { format: 'ombuto-ost', version: 1, name: 'x', nodes: [{ id: 1, type: 'nope' }] } as never,
        dirty: true,
        fileName: null,
        handle: null,
        savedAt: null,
      });
      await doc.init();
      expect(doc.ready).toBe(true);
      expect(doc.hasDocument).toBe(false);
      // The storage itself works: autosave is not reported as off.
      expect(doc.autosaveFailed).toBe(false);
    });

    it('still starts when the browser storage cannot be read, and says that autosave is off', async () => {
      doc.setAutosaveStore({ load: () => Promise.reject(new Error('blocked')), save: async () => undefined, clear: async () => undefined });
      await doc.init();
      expect(doc.ready).toBe(true);
      expect(doc.hasDocument).toBe(false);
      expect(doc.autosaveFailed).toBe(true);
    });
  });

  describe('New tree / Load example', () => {
    it('New starts a tree with one product in rename mode, and it is not dirty', async () => {
      await doc.request('new');
      expect(doc.hasDocument).toBe(true);
      expect(doc.name).toBe('Untitled tree');
      expect(doc.dirty).toBe(false);
      expect(doc.fileName).toBeNull();
      expect(tree.nodes.map(n => n.id)).toEqual(['product-1']);
      const ui = useOstUiStore();
      expect(ui.selectedId).toBe('product-1');
      expect(ui.editingId).toBe('product-1');
      // The new document (with its product) is what the browser now holds.
      expect((await autosave.current())?.doc.nodes).toHaveLength(1);
      expect((await autosave.current())?.dirty).toBe(false);
    });

    it('Load example opens the built-in tree, clean and without a file', async () => {
      await doc.request('example');
      expect(doc.name).toBe('Example: meal-planning app');
      expect(doc.dirty).toBe(false);
      expect(doc.fileName).toBeNull();
      expect(tree.nodes.length).toBeGreaterThan(10);
    });

    it('every document shown gets a new session number and starts expanded', async () => {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify({ 'opportunity-3': true }));
      await doc.request('example');
      const first = doc.session;
      expect(useOstUiStore().collapsed).toEqual({});
      expect(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)!)).toEqual({});
      await doc.request('new');
      expect(doc.session).toBe(first + 1);
    });
  });

  describe('dirty tracking and autosave', () => {
    beforeEach(async () => {
      await doc.request('example');
      autosave.saves.length = 0;
      vi.useFakeTimers();
    });

    it('any tree edit marks the document dirty', async () => {
      expect(doc.dirty).toBe(false);
      await tree.patchNode('product-1', { title: 'Renamed product' });
      expect(doc.dirty).toBe(true);
    });

    it('a refused edit does not', async () => {
      expect(await tree.patchNode('product-1', { title: 'x' })).toBe(false);
      expect(doc.dirty).toBe(false);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
      expect(autosave.saves).toHaveLength(0);
    });

    it('renaming the document is a change too; the name is cleaned', () => {
      doc.rename('  Meals   v2 ');
      expect(doc.name).toBe('Meals v2');
      expect(doc.dirty).toBe(true);
    });

    it('renaming to the same name changes nothing', () => {
      doc.rename('Example: meal-planning app');
      expect(doc.dirty).toBe(false);
    });

    it('writes the working document to the browser once, shortly after a burst of edits', async () => {
      await tree.patchNode('product-1', { title: 'One' });
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 50);
      await tree.patchNode('product-1', { title: 'Two' });
      await tree.createNode('product-1', 'outcome');
      expect(autosave.saves).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
      expect(autosave.saves).toHaveLength(1);
      const [saved] = autosave.saves;
      expect(saved.dirty).toBe(true);
      expect(saved.doc.nodes.find(n => n.id === 1)?.title).toBe('Two');
      expect(saved.doc.nodes.filter(n => n.type === 'outcome')).toHaveLength(2);
    });

    it('flushAutosave writes a pending autosave at once (the page is closing)', async () => {
      await tree.patchNode('product-1', { title: 'Closing' });
      await doc.flushAutosave();
      expect(autosave.saves).toHaveLength(1);
      // Nothing pending: nothing more is written.
      await doc.flushAutosave();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
      expect(autosave.saves).toHaveLength(1);
    });

    it('a failing browser storage never breaks editing, and says that autosave is off', async () => {
      expect(doc.autosaveFailed).toBe(false);
      doc.setAutosaveStore({ load: async () => null, save: () => Promise.reject(new Error('quota')), clear: async () => undefined });
      await tree.patchNode('product-1', { title: 'Still works' });
      // The flush settles, and says the browser does not hold the document.
      await expect(doc.flushAutosave()).resolves.toBe(false);
      expect(tree.byId('product-1')?.title).toBe('Still works');
      expect(doc.autosaveFailed).toBe(true);
    });

    it('autosave is back on as soon as a write goes through again', async () => {
      let full = true;
      const inner = memoryAutosave();
      doc.setAutosaveStore({ ...inner, save: record => (full ? Promise.reject(new Error('quota')) : inner.save(record)) });
      await tree.patchNode('product-1', { title: 'One' });
      await doc.flushAutosave();
      expect(doc.autosaveFailed).toBe(true);
      full = false;
      await tree.patchNode('product-1', { title: 'Two' });
      await doc.flushAutosave();
      expect(doc.autosaveFailed).toBe(false);
      expect((await inner.load())?.doc.nodes.find(n => n.id === 1)?.title).toBe('Two');
    });

    it('a browser with no storage to autosave into has autosave off from the start', async () => {
      doc.setAutosaveStore({ ...memoryAutosave(), persistent: false });
      expect(doc.autosaveFailed).toBe(true);
      await tree.patchNode('product-1', { title: 'Kept in memory only' });
      await doc.flushAutosave();
      expect(doc.autosaveFailed).toBe(true);
    });

    it('what is autosaved is a plain, valid document', async () => {
      await tree.addLink('product-1', { name: 'Site', url: 'https://example.com' });
      await doc.flushAutosave();
      const record = autosave.saves.at(-1)!;
      expect(() => structuredClone(record)).not.toThrow();
      expect(parseDocument(serializeDocument(record.doc)).nodes[0].links).toHaveLength(1);
    });
  });

  describe('Save / Save as without file handles (Firefox, Safari)', () => {
    beforeEach(async () => {
      await doc.request('example');
      await tree.patchNode('product-1', { title: 'Edited product' });
    });

    it('Save downloads a copy named after the document and clears the dirty flag', async () => {
      expect(await doc.save()).toBe(true);
      expect(io.downloadFile).toHaveBeenCalledTimes(1);
      const [name, text] = io.downloadFile.mock.calls[0];
      expect(name).toBe('Example meal-planning app.ost');
      expect(parseDocument(text as string).nodes[0].title).toBe('Edited product');
      expect(doc.dirty).toBe(false);
      expect(doc.fileName).toBe('Example meal-planning app.ost');
      expect(doc.savesInPlace).toBe(false);
      expect(doc.lastSavedAt).not.toBeNull();
      expect((await autosave.current())?.dirty).toBe(false);
    });

    it('a later edit makes it dirty again', async () => {
      await doc.save();
      await tree.patchNode('product-1', { title: 'Edited again' });
      expect(doc.dirty).toBe(true);
    });

    it('nothing to save without a document', async () => {
      setup();
      expect(await doc.save()).toBe(false);
      expect(await doc.saveAs()).toBe(false);
      expect(io.downloadFile).not.toHaveBeenCalled();
    });
  });

  describe('Save / Save as with file handles (Chromium)', () => {
    beforeEach(async () => {
      io.supportsFileHandles.mockReturnValue(true);
      await doc.request('example');
      await tree.patchNode('product-1', { title: 'Edited product' });
    });

    it('the first Save asks where to save, then keeps the handle', async () => {
      const handle = fakeHandle('meals.ost');
      io.pickFileToSave.mockResolvedValue(handle);
      expect(await doc.save()).toBe(true);
      expect(io.pickFileToSave).toHaveBeenCalledWith('Example meal-planning app.ost', expect.stringContaining('"Edited product"'));
      expect(doc.fileName).toBe('meals.ost');
      expect(doc.savesInPlace).toBe(true);
      expect(doc.dirty).toBe(false);
      expect((await autosave.current())?.handle).toBe(handle);
    });

    it('the next Save writes straight back to the same file', async () => {
      const handle = fakeHandle('meals.ost');
      io.pickFileToSave.mockResolvedValue(handle);
      await doc.save();
      await tree.patchNode('product-1', { title: 'Second edit' });
      io.writeToHandle.mockResolvedValue(undefined);
      expect(await doc.save()).toBe(true);
      expect(io.pickFileToSave).toHaveBeenCalledTimes(1);
      expect(io.writeToHandle).toHaveBeenCalledWith(handle, expect.stringContaining('"Second edit"'), null);
      expect(doc.dirty).toBe(false);
    });

    it('cancelling the save picker saves nothing and stays dirty', async () => {
      io.pickFileToSave.mockResolvedValue(null);
      expect(await doc.save()).toBe(false);
      expect(doc.dirty).toBe(true);
      expect(doc.fileName).toBeNull();
      expect(doc.error).toBeNull();
    });

    it('when the file can no longer be written, Save asks where to save instead', async () => {
      io.pickFileToSave.mockResolvedValue(fakeHandle('meals.ost'));
      await doc.save();
      await tree.patchNode('product-1', { title: 'Third edit' });
      io.writeToHandle.mockRejectedValue(new DOMException('gone', 'NotFoundError'));
      io.pickFileToSave.mockResolvedValue(fakeHandle('elsewhere.ost'));
      expect(await doc.save()).toBe(true);
      expect(doc.fileName).toBe('elsewhere.ost');
    });

    it('Save as always asks, and a failure is reported without losing the dirty flag', async () => {
      io.pickFileToSave.mockRejectedValue(new Error('disk full'));
      expect(await doc.saveAs()).toBe(false);
      expect(doc.error).toBe('The tree could not be saved to your computer.');
      expect(doc.dirty).toBe(true);
      doc.clearError();
      expect(doc.error).toBeNull();
    });
  });

  describe('Open file', () => {
    it('opens a valid file: clean, with its file name and handle', async () => {
      const handle = fakeHandle('meals.ost');
      io.pickFileToOpen.mockResolvedValue({ text: sampleText(), fileName: 'meals.ost', handle });
      await doc.request('open');
      expect(doc.hasDocument).toBe(true);
      expect(doc.name).toBe('Example: meal-planning app');
      expect(doc.fileName).toBe('meals.ost');
      expect(doc.savesInPlace).toBe(true);
      expect(doc.dirty).toBe(false);
      expect(tree.nodes.length).toBeGreaterThan(10);
      expect((await autosave.current())?.fileName).toBe('meals.ost');
    });

    it('cancelling the picker changes nothing', async () => {
      await doc.request('example');
      io.pickFileToOpen.mockResolvedValue(null);
      expect(await doc.openFile()).toBe(false);
      expect(doc.name).toBe('Example: meal-planning app');
      expect(doc.error).toBeNull();
    });

    it('refuses a file that is not an Ombuto OST tree, with a clear message, and keeps the open document', async () => {
      await doc.request('example');
      await tree.patchNode('product-1', { title: 'Mine' });
      io.pickFileToOpen.mockResolvedValue({ text: '{"some":"json"}', fileName: 'other.json', handle: null });
      expect(await doc.openFile()).toBe(false);
      expect(doc.error).toBe('This file is not an Ombuto OST tree.');
      expect(tree.byId('product-1')?.title).toBe('Mine');
      expect(doc.dirty).toBe(true);
      expect(doc.fileName).toBeNull();
    });

    it('says what is wrong with a damaged tree file', async () => {
      const broken = JSON.parse(sampleText());
      broken.nodes[1].parentId = 999;
      io.pickFileToOpen.mockResolvedValue({ text: JSON.stringify(broken), fileName: 'broken.ost', handle: null });
      await doc.openFile();
      expect(doc.error).toMatch(/^This file cannot be opened: node 2 refers to a parent \(999\)/);
      expect(doc.hasDocument).toBe(false);
    });

    it('reports a file that is too large, and any other read failure, in plain words', async () => {
      io.pickFileToOpen.mockRejectedValue(new files.FileTooLargeError());
      await doc.openFile();
      expect(doc.error).toBe('That file is too large to be an Ombuto OST tree.');
      io.pickFileToOpen.mockRejectedValue(new Error('EIO: something low-level'));
      await doc.openFile();
      expect(doc.error).toBe('That file could not be opened.');
    });
  });

  describe('replacing a document that has unsaved changes', () => {
    beforeEach(async () => {
      await doc.request('example');
      await tree.patchNode('product-1', { title: 'Unsaved work' });
    });

    it.each(['new', 'open', 'example'] as const)('%s waits for the user instead of replacing it', async action => {
      await doc.request(action);
      expect(doc.pendingAction).toBe(action);
      expect(tree.byId('product-1')?.title).toBe('Unsaved work');
      expect(io.pickFileToOpen).not.toHaveBeenCalled();
    });

    it('Cancel keeps everything', async () => {
      await doc.request('new');
      await doc.resolvePending('cancel');
      expect(doc.pendingAction).toBeNull();
      expect(tree.byId('product-1')?.title).toBe('Unsaved work');
      expect(doc.dirty).toBe(true);
    });

    it("Don't save carries on and the changes are gone", async () => {
      await doc.request('new');
      await doc.resolvePending('discard');
      expect(doc.pendingAction).toBeNull();
      expect(doc.name).toBe('Untitled tree');
      expect(tree.nodes).toHaveLength(1);
      expect(io.downloadFile).not.toHaveBeenCalled();
    });

    it('Save to a file saves first, then carries on', async () => {
      io.supportsFileHandles.mockReturnValue(true);
      io.pickFileToSave.mockResolvedValue(fakeHandle('work.ost'));
      await doc.request('example');
      await doc.resolvePending('save');
      expect(String(io.pickFileToSave.mock.calls[0][1])).toContain('Unsaved work');
      expect(doc.pendingAction).toBeNull();
      expect(tree.byId('product-1')?.title).toBe('Meal-planning app');
      expect(doc.dirty).toBe(false);
    });

    it('Save that can only download a copy waits for the user before replacing the tree', async () => {
      await doc.request('example');
      await doc.resolvePending('save');
      expect(io.downloadFile).toHaveBeenCalledTimes(1);
      expect(String(io.downloadFile.mock.calls[0][1])).toContain('Unsaved work');
      // The app cannot see whether the download arrived: the tree is still the open one.
      expect(doc.pendingAction).toBe('example');
      expect(doc.pendingDownloaded).toBe(true);
      expect(tree.byId('product-1')?.title).toBe('Unsaved work');
      // "Carry on".
      await doc.resolvePending('discard');
      expect(doc.pendingAction).toBeNull();
      expect(doc.pendingDownloaded).toBe(false);
      expect(tree.byId('product-1')?.title).toBe('Meal-planning app');
      expect(doc.dirty).toBe(false);
    });

    it('after such a download, Cancel keeps the tree, now marked as downloaded', async () => {
      await doc.request('new');
      await doc.resolvePending('save');
      await doc.resolvePending('cancel');
      expect(doc.pendingAction).toBeNull();
      expect(tree.byId('product-1')?.title).toBe('Unsaved work');
      expect(doc.savedBy).toBe('download');
    });

    it('Save that does not go through (picker cancelled) keeps the document', async () => {
      io.supportsFileHandles.mockReturnValue(true);
      io.pickFileToSave.mockResolvedValue(null);
      await doc.request('new');
      await doc.resolvePending('save');
      expect(tree.byId('product-1')?.title).toBe('Unsaved work');
      expect(doc.dirty).toBe(true);
    });

    it('a clean document is replaced without asking', async () => {
      await doc.save();
      await doc.request('new');
      expect(doc.pendingAction).toBeNull();
      expect(doc.name).toBe('Untitled tree');
    });

    it('tells the user to choose Open file again when the browser will not open a picker any more', async () => {
      io.pickFileToOpen.mockRejectedValue(new DOMException('Must be handling a user gesture', 'SecurityError'));
      io.supportsFileHandles.mockReturnValue(true);
      io.pickFileToSave.mockResolvedValue(fakeHandle('work.ost'));
      await doc.request('open');
      await doc.resolvePending('save');
      expect(doc.error).toBe('Choose “Open file” again to pick the file.');
      // The save itself went through.
      expect(doc.dirty).toBe(false);
    });
  });

  it('reportError shows a message through the same slot as file errors', () => {
    doc.reportError('SVG export is not available yet.');
    expect(doc.error).toBe('SVG export is not available yet.');
  });
});
