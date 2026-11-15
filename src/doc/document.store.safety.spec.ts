/*
 * The document store's promises about not losing work: a file that cannot be shown leaves the open
 * tree alone, a working copy that cannot be read is kept, an edit made during a save is not marked
 * saved, text still being typed counts, and the update reload only skips the browser's question
 * when the working copy is known to be stored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPinia, setActivePinia } from 'pinia';

import { useOstTreeStore } from '@/ost/stores/ost-tree.store';
import { COLLAPSED_STORAGE_KEY, useOstUiStore } from '@/ost/stores/ost-ui.store';

import { type AutosaveRecord, type AutosaveStore, MIGRATED_SLOT_ID, memoryAutosave } from './autosave';
import { slotCollapsedKey } from './autosave-slots';
import { MAX_DEPTH, MAX_NODES, type OstDocument, serializeDocument } from './document';
import { useDocumentStore } from './document.store';
import * as files from './file-access';
import { registerPendingEdit } from './pending-edits';
import { sampleDocument } from './sample';
import { legacyFileText } from './small-document.test-util';

vi.mock(import('./file-access'), async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    supportsFileHandles: vi.fn(() => false),
    pickFileToOpen: vi.fn(),
    pickFileToSave: vi.fn(),
    writeToHandle: vi.fn(),
    downloadFile: vi.fn(),
    fileStamp: vi.fn(async () => null),
  };
});

const io = vi.mocked(files);
const fakeHandle = (name: string) => ({ name, kind: 'file' }) as unknown as FileSystemFileHandle;
const opened = (text: string, extra: Partial<files.OpenedFile> = {}): files.OpenedFile => ({
  text,
  fileName: 'chosen.ost',
  handle: null,
  ...extra,
});

const node = (id: number, type: string, parentId: number | null, extra: object = {}) => ({
  id,
  type,
  parentId,
  title: `${type} ${id}`,
  ...(type === 'opportunity' ? { status: 'exploring', priority: 50, valueRating: 3 } : {}),
  ...extra,
});
const fileText = (nodes: object[]) => JSON.stringify({ format: 'ombuto-ost', version: 1, name: 'From a file', nodes });

/** project > outcome > a chain of `levels - 2` opportunities. */
function chain(levels: number) {
  const nodes = [node(1, 'project', null), node(2, 'outcome', 1)];
  for (let id = 3; id <= levels; id++) nodes.push(node(id, 'opportunity', id - 1));
  return nodes;
}

describe('document store: nothing is lost, nothing unreadable is saved', () => {
  let doc: ReturnType<typeof useDocumentStore>;
  let tree: ReturnType<typeof useOstTreeStore>;
  let saves: AutosaveRecord[];

  function setup(store: AutosaveStore = memoryAutosave()) {
    setActivePinia(createPinia());
    saves = [];
    doc = useDocumentStore();
    tree = useOstTreeStore();
    doc.setAutosaveStore({
      ...store,
      save: async record => {
        saves.push(record);
        await store.save(record);
      },
    });
  }

  /** An open tree with one unsaved edit. */
  async function openWork() {
    await doc.request('example');
    await tree.patchNode('project-1', { title: 'My work' });
    await doc.flushAutosave();
    saves.length = 0;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    io.supportsFileHandles.mockReturnValue(false);
    io.fileStamp.mockResolvedValue(null);
    localStorage.clear();
    setup();
  });

  describe('a file that cannot be shown leaves the open tree untouched', () => {
    it.each([
      ['deeper than the limit', () => fileText(chain(MAX_DEPTH + 1)), /more than \d+ levels deep/],
      ['a 3,000-level chain', () => fileText(chain(3000)), /more than|levels deep/],
      [
        'more nodes than the limit',
        () => fileText([node(1, 'project', null), ...Array.from({ length: MAX_NODES }, (_, i) => node(i + 2, 'outcome', 1))]),
        /more than/,
      ],
      ['not a tree at all', () => '{"hello":"world"}', /not an Ombuto OST tree/],
    ])('%s: a clear message, the tree and its autosave as they were', async (_label, text, message) => {
      await openWork();
      await doc.resolvePending('cancel');
      io.pickFileToOpen.mockResolvedValue(opened(text()));
      expect(await doc.openFile()).toBe(false);
      expect(doc.error).toMatch(message);
      expect(doc.name).toBe('Example: meal-planning app');
      expect(tree.byId('project-1')?.title).toBe('My work');
      expect(doc.dirty).toBe(true);
      expect(tree.loaded).toBe(true);
      expect(saves).toHaveLength(0);
    });

    it('a tree at the depth limit opens, lays out, and can be edited', async () => {
      io.pickFileToOpen.mockResolvedValue(opened(fileText(chain(MAX_DEPTH))));
      expect(await doc.openFile()).toBe(true);
      expect(tree.nodes).toHaveLength(MAX_DEPTH);
      expect(tree.placed[`opportunity-${MAX_DEPTH}`].depth).toBe(MAX_DEPTH - 1);
      expect(tree.descendantCount('project-1')).toBe(MAX_DEPTH - 1);
      // One level more is refused where it would be made, with a message.
      expect(await tree.createNode(`opportunity-${MAX_DEPTH}`, 'opportunity')).toBeNull();
      expect(tree.error).toMatch(/levels deep/);
    });

    it('a failure while building the tree (not caught by validation) also changes nothing', async () => {
      await openWork();
      await doc.resolvePending('cancel');
      vi.spyOn(tree, 'prepare').mockImplementationOnce(() => {
        throw new RangeError('Maximum call stack size exceeded');
      });
      io.pickFileToOpen.mockResolvedValue(opened(serializeDocument(sampleDocument())));
      expect(await doc.openFile()).toBe(false);
      expect(doc.error).toMatch(/cannot be opened/);
      expect(tree.byId('project-1')?.title).toBe('My work');
      expect(doc.service.snapshot()?.nodes[0].title).toBe('My work');
      expect(saves).toHaveLength(0);
    });
  });

  describe('a working copy that cannot be read', () => {
    const damaged = {
      format: 'ombuto-ost',
      version: 1,
      name: 'x',
      nodes: [{ id: 1, type: 'nope', title: 'Precious' }],
    } as unknown as OstDocument;
    const record: AutosaveRecord = { doc: damaged, dirty: true, fileName: null, handle: null, savedAt: null };

    /** A store with slots, as the app has: the damaged copy sits in slot "old". */
    function slotStore() {
      const slots = new Map<string, AutosaveRecord>([['old', record]]);
      let current = 'old';
      const store: AutosaveStore = {
        load: async () => slots.get(current) ?? null,
        save: async r => void slots.set(current, r),
        clear: async () => void slots.delete(current),
        slotId: () => current,
        setAside: async () => {
          const aside = current;
          current = 'fresh';
          return aside;
        },
        discard: async id => void slots.delete(id),
      };
      return { store, slots };
    }

    it('is reported, not swallowed; it is not deleted, and new work does not overwrite it', async () => {
      const { store, slots } = slotStore();
      setup(store);
      await doc.init();
      expect(doc.ready).toBe(true);
      expect(doc.hasDocument).toBe(false);
      expect(doc.unreadable).toEqual({ id: 'old', text: expect.stringContaining('"Precious"') });
      expect(slots.get('old')).toBe(record);
      // Starting a new tree goes to another slot.
      await doc.request('new');
      expect(slots.get('old')).toBe(record);
      expect(slots.get('fresh')?.doc.name).toBe('Untitled tree');
    });

    it('its raw contents can be saved to the computer, and it is deleted only when the user says so', async () => {
      const { store, slots } = slotStore();
      setup(store);
      await doc.init();
      doc.saveUnreadable();
      expect(io.downloadFile).toHaveBeenCalledTimes(1);
      const [name, text] = io.downloadFile.mock.calls[0];
      expect(name).toMatch(/recovered.*\.json$/);
      expect(JSON.parse(String(text))).toEqual(damaged);
      expect(slots.has('old')).toBe(true);
      await doc.discardUnreadable();
      expect(slots.has('old')).toBe(false);
      expect(doc.unreadable).toBeNull();
    });
  });

  describe('each tab keeps the collapsed branches of its own working copy', () => {
    it('reads and writes them under its slot', async () => {
      localStorage.setItem(slotCollapsedKey('tab-1'), JSON.stringify({ 'opportunity-4': true }));
      localStorage.setItem(slotCollapsedKey('tab-2'), JSON.stringify({ 'outcome-3': true }));
      const inner = memoryAutosave({ doc: sampleDocument(), dirty: false, fileName: null, handle: null, savedAt: null });
      setup({ ...inner, slotId: () => 'tab-1' });
      await doc.init();
      const ui = useOstUiStore();
      expect(ui.collapsed).toEqual({ 'opportunity-4': true });
      ui.setCollapsed('outcome-3', true);
      expect(JSON.parse(localStorage.getItem(slotCollapsedKey('tab-1'))!)).toEqual({ 'opportunity-4': true, 'outcome-3': true });
      expect(JSON.parse(localStorage.getItem(slotCollapsedKey('tab-2'))!)).toEqual({ 'outcome-3': true });
      ui.useCollapsedKey(COLLAPSED_STORAGE_KEY);
    });

    it("a tab's own working copy from the first published build comes back with its products as projects", async () => {
      localStorage.setItem(slotCollapsedKey('tab-1'), JSON.stringify({ 'product-1': true }));
      localStorage.setItem(slotCollapsedKey('tab-2'), JSON.stringify({ 'product-1': true, 'outcome-2': true }));
      const inner = memoryAutosave({ doc: JSON.parse(legacyFileText()), dirty: true, fileName: null, handle: null, savedAt: null });
      setup({ ...inner, slotId: () => 'tab-1' });
      await doc.init();
      const ui = useOstUiStore();
      expect(doc.unreadable).toBeNull();
      expect(doc.dirty).toBe(true);
      expect(tree.byId('project-1')?.type).toBe('project');
      expect(ui.collapsed).toEqual({ 'project-1': true });
      // Restoring writes nothing; the first change rewrites this tab's copy, and only this tab's.
      expect(saves).toHaveLength(0);
      ui.setCollapsed('project-1', false);
      expect(JSON.parse(localStorage.getItem(slotCollapsedKey('tab-1'))!)).toEqual({});
      expect(JSON.parse(localStorage.getItem(slotCollapsedKey('tab-2'))!)).toEqual({ 'product-1': true, 'outcome-2': true });
      await tree.patchNode('project-1', { title: 'Still mine' });
      await doc.flushAutosave();
      expect(saves.at(-1)!.doc.nodes[0]).toMatchObject({ type: 'project', title: 'Still mine' });
      ui.useCollapsedKey(COLLAPSED_STORAGE_KEY);
    });

    it('the collapsed branches of the single working copy of version 1 move with it', async () => {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify({ 'opportunity-4': true }));
      const inner = memoryAutosave({ doc: sampleDocument(), dirty: false, fileName: null, handle: null, savedAt: null });
      setup({ ...inner, slotId: () => MIGRATED_SLOT_ID });
      await doc.init();
      expect(useOstUiStore().collapsed).toEqual({ 'opportunity-4': true });
      expect(localStorage.getItem(COLLAPSED_STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem(slotCollapsedKey(MIGRATED_SLOT_ID))).not.toBeNull();
      useOstUiStore().useCollapsedKey(COLLAPSED_STORAGE_KEY);
    });
  });

  describe('an edit made while a save is under way is not marked saved', () => {
    it('Save as: an edit while the save picker is open keeps the document unsaved', async () => {
      await openWork();
      io.supportsFileHandles.mockReturnValue(true);
      let choose!: (handle: FileSystemFileHandle) => void;
      io.pickFileToSave.mockReturnValue(new Promise(resolve => (choose = resolve)));
      const saving = doc.saveAs();
      await tree.patchNode('project-1', { title: 'Edited while the picker was open' });
      choose(fakeHandle('work.ost'));
      expect(await saving).toBe(true);
      // What reached the file is the document as it was when Save was chosen.
      expect(String(io.pickFileToSave.mock.calls[0][1])).toContain('"My work"');
      expect(doc.fileName).toBe('work.ost');
      expect(doc.dirty).toBe(true);
      // The next save has nothing racing it.
      io.writeToHandle.mockResolvedValue(undefined);
      expect(await doc.save()).toBe(true);
      expect(doc.dirty).toBe(false);
    });

    it('Save: an edit while the file is being written keeps the document unsaved', async () => {
      await openWork();
      io.supportsFileHandles.mockReturnValue(true);
      io.pickFileToSave.mockResolvedValue(fakeHandle('work.ost'));
      await doc.save();
      await tree.patchNode('project-1', { title: 'Second' });
      let finish!: () => void;
      io.writeToHandle.mockReturnValue(new Promise(resolve => (finish = resolve)));
      const saving = doc.save();
      await tree.patchNode('project-1', { title: 'Third, during the write' });
      finish();
      expect(await saving).toBe(true);
      expect(doc.dirty).toBe(true);
    });

    it('a save that finishes after another document was opened records nothing on the new one', async () => {
      await openWork();
      io.supportsFileHandles.mockReturnValue(true);
      let choose!: (handle: FileSystemFileHandle) => void;
      io.pickFileToSave.mockReturnValue(new Promise(resolve => (choose = resolve)));
      const saving = doc.saveAs();
      await doc.resolvePending('cancel');
      doc.dirty = false;
      await doc.request('new');
      choose(fakeHandle('old-work.ost'));
      await saving;
      expect(doc.name).toBe('Untitled tree');
      expect(doc.fileName).toBeNull();
      expect(doc.savesInPlace).toBe(false);
    });
  });

  describe('two tabs with the same file open', () => {
    it('Save does not overwrite a file that changed behind this tab: it says so and asks where to save', async () => {
      io.supportsFileHandles.mockReturnValue(true);
      const handle = fakeHandle('shared.ost');
      io.pickFileToOpen.mockResolvedValue(opened(serializeDocument(sampleDocument()), { fileName: 'shared.ost', handle, stamp: '100:10' }));
      await doc.openFile();
      await tree.patchNode('project-1', { title: 'Mine' });
      io.writeToHandle.mockRejectedValue(new files.FileChangedError());
      io.pickFileToSave.mockResolvedValue(null); // the user closes the picker
      expect(await doc.save()).toBe(false);
      expect(io.writeToHandle).toHaveBeenCalledWith(handle, expect.any(String), '100:10');
      expect(doc.error).toMatch(/shared\.ost.*changed outside this tab.*not overwritten/);
      expect(doc.dirty).toBe(true);
    });

    it('after a save the tab knows the file as it wrote it', async () => {
      io.supportsFileHandles.mockReturnValue(true);
      const handle = fakeHandle('mine.ost');
      io.pickFileToOpen.mockResolvedValue(opened(serializeDocument(sampleDocument()), { fileName: 'mine.ost', handle, stamp: '100:10' }));
      await doc.openFile();
      io.writeToHandle.mockResolvedValue(undefined);
      io.fileStamp.mockResolvedValue('200:12');
      await tree.patchNode('project-1', { title: 'One' });
      await doc.save();
      await tree.patchNode('project-1', { title: 'Two' });
      await doc.save();
      expect(io.writeToHandle).toHaveBeenLastCalledWith(handle, expect.any(String), '200:12');
    });
  });

  describe('text still being typed in a field', () => {
    /** A field holding a draft: flushing it puts the text in the document. */
    const typing = (text: string) => registerPendingEdit(() => void tree.patchNode('project-1', { note: text }));

    it.each(['new', 'open', 'example'] as const)('%s: counts as an unsaved change, so the user is asked first', async action => {
      await doc.request('example');
      expect(doc.dirty).toBe(false);
      const done = typing('typed, not blurred');
      await doc.request(action);
      done();
      expect(doc.pendingAction).toBe(action);
      expect(io.pickFileToOpen).not.toHaveBeenCalled();
      expect(tree.byId('project-1')?.note).toBe('typed, not blurred');
    });

    it('Save and Save as write it to the file', async () => {
      await doc.request('example');
      const done = typing('in the file');
      await doc.save();
      done();
      expect(String(io.downloadFile.mock.calls[0][1])).toContain('in the file');
    });

    it('the last autosave (page hidden or closing) includes it and marks the document unsaved', async () => {
      await doc.request('example');
      saves.length = 0;
      expect(doc.warnsBeforeLeaving()).toBe(false);
      const done = typing('about to be lost');
      const flushed = doc.flushAutosave();
      done();
      // Synchronously, before the browser decides whether to ask:
      expect(doc.warnsBeforeLeaving()).toBe(true);
      expect(await flushed).toBe(true);
      expect(saves.at(-1)?.doc.nodes[0].notes).toBe('about to be lost');
      expect(saves.at(-1)?.dirty).toBe(true);
    });
  });

  describe('the reload for a new version', () => {
    it('skips the browser’s question only once the working copy is confirmed stored, and only until the next edit', async () => {
      await openWork();
      await doc.resolvePending('cancel');
      expect(doc.warnsBeforeLeaving()).toBe(true);
      expect(await doc.flushAutosave()).toBe(true);
      doc.clearToReload();
      expect(doc.warnsBeforeLeaving()).toBe(false);
      await tree.patchNode('project-1', { title: 'One more edit' });
      expect(doc.warnsBeforeLeaving()).toBe(true);
    });

    it('flushAutosave is false when the browser did not keep the document', async () => {
      setup({ ...memoryAutosave(), save: () => Promise.reject(new Error('quota')) });
      await doc.request('example');
      await tree.patchNode('project-1', { title: 'Edited' });
      expect(await doc.flushAutosave()).toBe(false);
      expect(doc.warnsBeforeLeaving()).toBe(true);
    });
  });
});
