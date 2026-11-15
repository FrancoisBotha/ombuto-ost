/*
 * Undo and redo as the app runs them: the document store steps the history, the tree on screen
 * follows, the view survives, and the saved / unsaved state and the autosaved copy stay truthful.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPinia, setActivePinia } from 'pinia';

import { useOstTreeStore } from '@/ost/stores/ost-tree.store';
import { useOstUiStore } from '@/ost/stores/ost-ui.store';

import { type AutosaveRecord, memoryAutosave } from './autosave';
import { serializeDocument } from './document';
import { AUTOSAVE_DELAY_MS, useDocumentStore } from './document.store';
import * as files from './file-access';
import { registerPendingEdit } from './pending-edits';
import { smallDocument } from './small-document.test-util';

vi.mock(import('./file-access'), async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    supportsFileHandles: vi.fn(() => false),
    pickFileToOpen: vi.fn(),
    pickFileToSave: vi.fn(),
    writeToHandle: vi.fn(),
    fileStamp: vi.fn(async () => 'stamp'),
    downloadFile: vi.fn(),
  };
});

const io = vi.mocked(files);
const STAMP = new Date('2026-01-02T03:04:05Z');
const fileText = () => serializeDocument(smallDocument(STAMP));
const fakeHandle = (name: string) => ({ name, kind: 'file' }) as unknown as FileSystemFileHandle;

describe('document store: undo and redo', () => {
  let doc: ReturnType<typeof useDocumentStore>;
  let tree: ReturnType<typeof useOstTreeStore>;
  let ui: ReturnType<typeof useOstUiStore>;
  let stored: ReturnType<typeof memoryAutosave>;

  const text = () => serializeDocument(doc.service.snapshot()!);
  const titles = () => tree.nodes.map(n => n.title);

  /** The small document, opened from a file: clean, with nothing to undo. */
  async function openFile(initial: AutosaveRecord | null = null) {
    setActivePinia(createPinia());
    stored = memoryAutosave(initial);
    doc = useDocumentStore();
    tree = useOstTreeStore();
    ui = useOstUiStore();
    doc.setAutosaveStore(stored);
    await doc.init();
    if (initial) return;
    io.pickFileToOpen.mockResolvedValue({ text: fileText(), fileName: 'meals.ost', handle: fakeHandle('meals.ost'), stamp: 'stamp' });
    expect(await doc.openFile()).toBe(true);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    io.supportsFileHandles.mockReturnValue(false);
    localStorage.clear();
    await openFile();
  });

  afterEach(() => vi.useRealTimers());

  it('has nothing to undo or redo in a document that was just opened', async () => {
    expect(doc.undoLabel).toBeNull();
    expect(doc.redoLabel).toBeNull();
    expect(await doc.undo()).toBe(false);
    expect(await doc.redo()).toBe(false);
    expect(doc.dirty).toBe(false);
  });

  it('names the step, undoes it on screen and in the document, and redoes it', async () => {
    const start = text();
    await tree.patchNode('project-1', { title: 'Renamed' });
    expect(doc.undoLabel).toBe('rename “Renamed”');
    expect(doc.redoLabel).toBeNull();

    expect(await doc.undo()).toBe(true);
    expect(tree.byId('project-1')!.title).toBe('Meal-planning app');
    expect(text()).toBe(start);
    expect(doc.undoLabel).toBeNull();
    expect(doc.redoLabel).toBe('rename “Renamed”');

    expect(await doc.redo()).toBe(true);
    expect(tree.byId('project-1')!.title).toBe('Renamed');
    expect(doc.undoLabel).toBe('rename “Renamed”');
    expect(doc.redoLabel).toBeNull();
  });

  it('undoing a delete brings the whole subtree back on screen, in place, with links and questions', async () => {
    const start = text();
    const before = titles();
    await tree.deleteNode('opportunity-3');
    expect(tree.nodes).toHaveLength(6);
    expect(await doc.undo()).toBe(true);
    expect(titles()).toEqual(before);
    expect(tree.byId('opportunity-3')!.questions).toHaveLength(2);
    expect(tree.byId('opportunity-11')!.links).toHaveLength(1);
    expect(text()).toBe(start);
  });

  describe('the view after an undo or redo', () => {
    it('keeps the selection, the collapsed branches and the focused project when their nodes are still there', async () => {
      ui.select('opportunity-11');
      ui.setCollapsed('solution-6', true);
      await tree.patchNode('opportunity-14', { title: 'Renamed' });
      await doc.undo();
      expect(ui.selectedId).toBe('opportunity-11');
      expect(ui.collapsed['solution-6']).toBe(true);
      expect(tree.selected?.title).toBe('The shopping list does not match the plan');
    });

    it('clears the selection (and so closes the panel) when the selected node is undone away', async () => {
      const key = (await tree.createNode('outcome-2', 'opportunity', 'Short-lived'))!;
      ui.stopEditing();
      expect(ui.selectedId).toBe(key);
      await doc.undo();
      expect(tree.byId(key)).toBeUndefined();
      expect(ui.selectedId).toBeNull();
      expect(tree.selected).toBeUndefined();
      expect(ui.editingId).toBeNull();
    });

    it('does not select a node that an undone delete brings back', async () => {
      ui.select('opportunity-3');
      await tree.deleteNode('opportunity-3');
      expect(ui.selectedId).toBeNull();
      await doc.undo();
      expect(tree.byId('opportunity-3')).toBeDefined();
      expect(ui.selectedId).toBeNull();
    });

    it('goes back to every project when the focused project is undone away', async () => {
      const key = (await tree.createProject('Second'))!;
      ui.stopEditing();
      ui.setProject(key);
      await doc.undo();
      expect(ui.projectId).toBe('all');
      expect(tree.roots.map(n => n.id)).toEqual(['project-1']);
    });

    it('says what happened, and shows it only when the change was somewhere the canvas does not show', async () => {
      await tree.patchNode('opportunity-3', { title: 'Seen' });
      await doc.undo();
      expect(ui.notice).toMatchObject({ text: 'Undid: rename “Seen”', show: false });

      // Inside a collapsed branch.
      await tree.patchNode('solution-6', { title: 'Hidden edit' });
      ui.setCollapsed('opportunity-3', true);
      await doc.undo();
      expect(ui.notice).toMatchObject({ text: 'Undid: rename “Hidden edit”', show: true });
      await doc.redo();
      expect(ui.notice).toMatchObject({ text: 'Redid: rename “Hidden edit”', show: true });
      ui.setCollapsed('opportunity-3', false);

      // Outside the focused project.
      const second = (await tree.createProject('Second'))!;
      ui.stopEditing();
      await tree.patchNode('opportunity-3', { title: 'Elsewhere' });
      ui.setProject(second);
      await doc.undo();
      expect(ui.notice).toMatchObject({ text: 'Undid: rename “Elsewhere”', show: true });
      expect(ui.projectId).toBe(second);

      // The name of the tree is in the top bar: always in view.
      doc.rename('Another name');
      await doc.undo();
      expect(ui.notice).toMatchObject({ text: 'Undid: rename the tree', show: false });
      expect(doc.name).toBe('Example: meal-planning app');
    });
  });

  describe('text being typed', () => {
    it('takes a draft into the document before undoing, so it is undone rather than lost or brought back later', async () => {
      await tree.patchNode('project-1', { note: 'First' });
      doc.sealHistory();
      // A field with a draft the document does not have yet.
      let draft: string | null = 'Half-typed';
      const unregister = registerPendingEdit(() => {
        if (draft !== null) void tree.patchNode('outcome-2', { title: draft });
        draft = null;
      });
      expect(await doc.undo()).toBe(true);
      unregister();
      // The draft was committed and then undone; it can be redone, and the earlier edit is still there.
      expect(draft).toBeNull();
      expect(tree.byId('outcome-2')!.title).toBe('More people plan a full week of meals');
      expect(tree.byId('project-1')!.note).toBe('First');
      expect(doc.redoLabel).toBe('rename “Half-typed”');
      await doc.redo();
      expect(tree.byId('outcome-2')!.title).toBe('Half-typed');
    });

    it('a burst of typing in one field is one undo step; after the field is left, the next burst is another', async () => {
      vi.useFakeTimers({ now: STAMP });
      for (const title of ['Me', 'Meal', 'Meals']) {
        await tree.patchNode('project-1', { title });
        vi.advanceTimersByTime(300);
      }
      doc.sealHistory(); // blur
      for (const title of ['Meals f', 'Meals for all']) {
        await tree.patchNode('project-1', { title });
        vi.advanceTimersByTime(300);
      }
      await doc.undo();
      expect(tree.byId('project-1')!.title).toBe('Meals');
      await doc.undo();
      expect(tree.byId('project-1')!.title).toBe('Meal-planning app');
      expect(doc.undoLabel).toBeNull();
    });
  });

  describe('saved and unsaved', () => {
    it('undoing back to the opened file reads as saved again; redoing reads as unsaved', async () => {
      await tree.patchNode('project-1', { title: 'One' });
      await tree.patchNode('project-1', { note: 'Two' });
      expect(doc.dirty).toBe(true);
      await doc.undo();
      expect(doc.dirty).toBe(true);
      await doc.undo();
      expect(doc.dirty).toBe(false);
      await doc.redo();
      expect(doc.dirty).toBe(true);
    });

    it('after a save, the saved state is the clean one: undo makes the document unsaved, redo saved', async () => {
      io.supportsFileHandles.mockReturnValue(true);
      await tree.patchNode('project-1', { title: 'One' });
      expect(await doc.save()).toBe(true);
      expect(doc.dirty).toBe(false);
      const saved = String(io.writeToHandle.mock.calls.at(-1)![1]);

      await doc.undo();
      expect(doc.dirty).toBe(true); // the file holds "One", the document does not
      await doc.redo();
      expect(doc.dirty).toBe(false);
      expect(text()).toBe(saved);

      await tree.patchNode('project-1', { note: 'Later' });
      expect(doc.dirty).toBe(true);
      await doc.undo();
      expect(doc.dirty).toBe(false);
      // Save still works from here, and writes the document as it is now.
      await doc.redo();
      expect(await doc.save()).toBe(true);
      expect(String(io.writeToHandle.mock.calls.at(-1)![1])).toBe(text());
      expect(doc.dirty).toBe(false);
    });

    it('typing that goes on after a save does not fold into the step that was saved', async () => {
      vi.useFakeTimers({ now: STAMP });
      io.supportsFileHandles.mockReturnValue(true);
      await tree.patchNode('project-1', { note: 'Typed' });
      vi.advanceTimersByTime(300);
      await doc.save();
      await tree.patchNode('project-1', { note: 'Typed and more' });
      expect(doc.dirty).toBe(true);
      await doc.undo();
      expect(tree.byId('project-1')!.note).toBe('Typed');
      expect(doc.dirty).toBe(false);
    });

    it('a working copy restored with unsaved changes stays unsaved whatever is undone', async () => {
      await openFile({ doc: smallDocument(STAMP), dirty: true, fileName: 'meals.ost', handle: null, savedAt: null });
      expect(doc.dirty).toBe(true);
      expect(doc.undoLabel).toBeNull(); // history does not survive a reload
      await tree.patchNode('project-1', { title: 'One' });
      await doc.undo();
      expect(doc.dirty).toBe(true);
    });

    it('the autosaved working copy follows an undo and a redo', async () => {
      vi.useFakeTimers({ now: STAMP });
      const autosaved = async () => {
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);
        const record = (await stored.load())!;
        return { title: record.doc.nodes[0].title, dirty: record.dirty };
      };
      await tree.patchNode('project-1', { title: 'One' });
      expect(await autosaved()).toEqual({ title: 'One', dirty: true });
      await doc.undo();
      expect(await autosaved()).toEqual({ title: 'Meal-planning app', dirty: false });
      await doc.redo();
      expect(await autosaved()).toEqual({ title: 'One', dirty: true });
    });
  });

  describe('another document', () => {
    beforeEach(async () => {
      await tree.patchNode('project-1', { title: 'One' });
      await tree.patchNode('project-1', { note: 'Two' });
      await doc.undo();
      expect(doc.undoLabel).not.toBeNull();
      expect(doc.redoLabel).not.toBeNull();
    });

    const cleared = async () => {
      expect(doc.undoLabel).toBeNull();
      expect(doc.redoLabel).toBeNull();
      expect(await doc.undo()).toBe(false);
      expect(await doc.redo()).toBe(false);
    };

    it('New clears the history, and its first project is not something to undo', async () => {
      await doc.request('new');
      await doc.resolvePending('discard');
      ui.stopEditing();
      expect(tree.nodes).toHaveLength(1);
      await cleared();
      expect(tree.nodes).toHaveLength(1);
      expect(doc.dirty).toBe(false);
    });

    it('Open file clears the history', async () => {
      await doc.request('open');
      await doc.resolvePending('discard');
      expect(tree.byId('project-1')!.title).toBe('Meal-planning app');
      await cleared();
    });

    it('Open example clears the history', async () => {
      await doc.request('example');
      await doc.resolvePending('discard');
      await cleared();
    });

    it('does nothing while the question about unsaved changes is open', async () => {
      await doc.request('new');
      expect(doc.pendingAction).toBe('new');
      expect(await doc.undo()).toBe(false);
      expect(tree.byId('project-1')!.title).toBe('One');
      await doc.resolvePending('cancel');
      expect(await doc.undo()).toBe(true);
    });
  });
});
