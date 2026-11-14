import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enableAutoUnmount, flushPromises } from '@vue/test-utils';

import * as files from '@/doc/file-access';

import OstShell from './OstShell.vue';
import { exampleRecord, key, mountShell, setupShellStores } from './shell.test-util';

vi.mock(import('@/doc/file-access'), async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    supportsFileHandles: vi.fn(() => false),
    pickFileToOpen: vi.fn(async () => null),
    pickFileToSave: vi.fn(async () => null),
    writeToHandle: vi.fn(),
    downloadFile: vi.fn(),
  };
});

const io = vi.mocked(files);

enableAutoUnmount(afterEach);

/** The canvas needs a real layout engine; the shell only decides WHETHER it is shown. */
const CanvasPage = { name: 'CanvasPage', template: '<div data-cy="canvas-stub"><input data-cy="stub-field" /></div>' };
const stubs = { CanvasPage };

describe('OstShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    io.supportsFileHandles.mockReturnValue(false);
    io.pickFileToOpen.mockResolvedValue(null);
  });

  describe('start-up', () => {
    it('shows the top bar and the empty state on a first visit', async () => {
      const { pinia } = setupShellStores();
      const w = await mountShell(OstShell, pinia, stubs);
      expect(w.find('[data-cy="ost-top-bar"]').exists()).toBe(true);
      expect(w.find('[data-cy="ost-empty-state"]').exists()).toBe(true);
      expect(w.find('[data-cy="canvas-stub"]').exists()).toBe(false);
      expect(w.find('[data-cy="ostLoading"]').exists()).toBe(false);
      // The privacy indicator is always there.
      expect(w.get('[data-cy="ost-privacy-indicator"]').text()).toBe('Stored on this device only');
    });

    it('says it is opening until the browser storage has been read, then shows what was found', async () => {
      const { pinia, doc } = setupShellStores();
      let release: () => void = () => undefined;
      doc.setAutosaveStore({
        load: () => new Promise(resolve => (release = () => resolve(exampleRecord()))),
        save: async () => undefined,
        clear: async () => undefined,
      });
      const w = await mountShell(OstShell, pinia, stubs);
      expect(w.get('[data-cy="ostLoading"]').text()).toBe('Opening…');
      expect(w.find('[data-cy="ost-empty-state"]').exists()).toBe(false);
      release();
      await flushPromises();
      expect(w.find('[data-cy="ostLoading"]').exists()).toBe(false);
      expect(w.find('[data-cy="canvas-stub"]').exists()).toBe(true);
    });

    it('restores the document this browser was working on', async () => {
      const { pinia } = setupShellStores(exampleRecord({ dirty: true }));
      const w = await mountShell(OstShell, pinia, stubs);
      expect(w.find('[data-cy="canvas-stub"]').exists()).toBe(true);
      expect(w.find('[data-cy="ost-empty-state"]').exists()).toBe(false);
      expect((w.get('[data-cy="ost-doc-name"]').element as HTMLInputElement).value).toBe('Example: meal-planning app');
      expect(w.get('[data-cy="ost-save-state"]').text()).toBe('Unsaved changes');
    });
  });

  describe('empty state', () => {
    it('New tree, Open file and Load example each start their action', async () => {
      const { pinia, doc } = setupShellStores();
      const w = await mountShell(OstShell, pinia, stubs);
      const request = vi.spyOn(doc, 'request');
      await w.get('[data-cy="ost-empty-open"]').trigger('click');
      await w.get('[data-cy="ost-empty-example"]').trigger('click');
      expect(request.mock.calls.map(c => c[0])).toEqual(['open', 'example']);
      await flushPromises();
      expect(w.find('[data-cy="canvas-stub"]').exists()).toBe(true);
    });

    it('New tree opens the canvas with an untitled tree', async () => {
      const { pinia, tree } = setupShellStores();
      const w = await mountShell(OstShell, pinia, stubs);
      await w.get('[data-cy="ost-empty-new"]').trigger('click');
      await flushPromises();
      expect(w.find('[data-cy="canvas-stub"]').exists()).toBe(true);
      expect((w.get('[data-cy="ost-doc-name"]').element as HTMLInputElement).value).toBe('Untitled tree');
      expect(tree.products).toHaveLength(1);
    });

    it('never says "upload"', async () => {
      const { pinia } = setupShellStores();
      const w = await mountShell(OstShell, pinia, stubs);
      expect(w.text().toLowerCase()).not.toContain('upload');
      expect(w.get('[data-cy="ost-empty-open"]').text()).toBe('Open file');
    });
  });

  describe('another document', () => {
    it('starts from a fresh canvas page', async () => {
      const { pinia, doc } = setupShellStores(exampleRecord());
      const w = await mountShell(OstShell, pinia, stubs);
      const first = w.get('[data-cy="canvas-stub"]').element;
      await doc.request('example');
      await flushPromises();
      expect(w.get('[data-cy="canvas-stub"]').element).not.toBe(first);
    });
  });

  describe('unsaved changes', () => {
    async function dirtyShell() {
      const ctx = setupShellStores(exampleRecord());
      const w = await mountShell(OstShell, ctx.pinia, stubs);
      await ctx.tree.patchNode('product-1', { title: 'Unsaved work' });
      await flushPromises();
      return { ...ctx, w };
    }

    it('asks before New replaces a document with unsaved changes, and Cancel keeps it', async () => {
      const { w, doc, tree } = await dirtyShell();
      expect(w.find('[data-cy="ostUnsavedDialog"]').exists()).toBe(false);
      await doc.request('new');
      await flushPromises();
      const dialog = w.get('[data-cy="ostUnsavedDialog"]');
      expect(dialog.attributes('role')).toBe('dialog');
      expect(dialog.attributes('aria-modal')).toBe('true');
      expect(w.get('[data-cy="ostUnsavedText"]').text()).toContain(
        '“Example: meal-planning app” has changes that are not saved to a file.',
      );
      expect(w.get('[data-cy="ostUnsavedText"]').text()).toContain('Starting a new tree without saving loses them.');
      // The safe choice has focus.
      expect(document.activeElement).toBe(w.get('[data-cy="ostUnsavedCancel"]').element);
      await w.get('[data-cy="ostUnsavedCancel"]').trigger('click');
      await flushPromises();
      expect(w.find('[data-cy="ostUnsavedDialog"]').exists()).toBe(false);
      expect(tree.byId('product-1')?.title).toBe('Unsaved work');
    });

    it("Don't save discards and carries on; Save saves first", async () => {
      const first = await dirtyShell();
      await first.doc.request('new');
      await flushPromises();
      await first.w.get('[data-cy="ostUnsavedDiscard"]').trigger('click');
      await flushPromises();
      expect(first.doc.name).toBe('Untitled tree');
      expect(io.downloadFile).not.toHaveBeenCalled();
      first.w.unmount();

      const second = await dirtyShell();
      await second.doc.request('new');
      await flushPromises();
      await second.w.get('[data-cy="ostUnsavedSave"]').trigger('click');
      await flushPromises();
      expect(io.downloadFile).toHaveBeenCalledTimes(1);
      expect(second.doc.name).toBe('Untitled tree');
    });

    it('Escape in the dialog is Cancel', async () => {
      const { w, doc, tree } = await dirtyShell();
      await doc.request('example');
      await flushPromises();
      await w.get('[data-cy="ostUnsavedDialog"]').trigger('keydown', { key: 'Escape' });
      await flushPromises();
      expect(doc.pendingAction).toBeNull();
      expect(tree.byId('product-1')?.title).toBe('Unsaved work');
    });

    it('closing the tab asks first only while there are unsaved changes', async () => {
      const { doc } = await dirtyShell();
      const leaving = () => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };
      expect(leaving()).toBe(true);
      await doc.save();
      expect(leaving()).toBe(false);
    });

    it('closing the tab never asks when no document is open', async () => {
      const { pinia } = setupShellStores();
      await mountShell(OstShell, pinia, stubs);
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });

    it('hiding the page writes a pending autosave at once', async () => {
      const { doc } = await dirtyShell();
      const flush = vi.spyOn(doc, 'flushAutosave');
      window.dispatchEvent(new Event('pagehide'));
      expect(flush).toHaveBeenCalled();
    });

    it('stops listening once the shell is gone', async () => {
      const { w } = await dirtyShell();
      w.unmount();
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('keyboard shortcuts', () => {
    it('Ctrl+S saves, Ctrl+Shift+S saves as, Cmd works too; the browser default never runs', async () => {
      const { pinia, doc } = setupShellStores(exampleRecord());
      await mountShell(OstShell, pinia, stubs);
      const save = vi.spyOn(doc, 'save');
      const saveAs = vi.spyOn(doc, 'saveAs');
      const press = async (init: KeyboardEventInit) => {
        const event = key('s', init);
        window.dispatchEvent(event);
        await flushPromises();
        return event.defaultPrevented;
      };
      expect(await press({ ctrlKey: true })).toBe(true);
      expect(save).toHaveBeenCalledTimes(1);
      expect(await press({ metaKey: true })).toBe(true);
      expect(save).toHaveBeenCalledTimes(2);
      expect(await press({ ctrlKey: true, shiftKey: true, key: 'S' })).toBe(true);
      expect(saveAs).toHaveBeenCalledTimes(1);
      // A plain "s" is just typing.
      expect(await press({})).toBe(false);
      expect(save).toHaveBeenCalledTimes(2);
    });

    it('Ctrl+O opens a file, also from the empty state', async () => {
      const { pinia, doc } = setupShellStores();
      await mountShell(OstShell, pinia, stubs);
      const request = vi.spyOn(doc, 'request');
      const event = key('o', { ctrlKey: true });
      window.dispatchEvent(event);
      await flushPromises();
      expect(event.defaultPrevented).toBe(true);
      expect(request).toHaveBeenCalledWith('open');
      expect(io.pickFileToOpen).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+S with no document open does nothing (but still keeps the browser dialog away)', async () => {
      const { pinia, doc } = setupShellStores();
      await mountShell(OstShell, pinia, stubs);
      const save = vi.spyOn(doc, 'save');
      const event = key('s', { ctrlKey: true });
      window.dispatchEvent(event);
      await flushPromises();
      expect(event.defaultPrevented).toBe(true);
      expect(save).not.toHaveBeenCalled();
    });

    it('Ctrl+S first commits the field being typed in, and gives focus back to it', async () => {
      const { pinia, doc } = setupShellStores(exampleRecord());
      const w = await mountShell(OstShell, pinia, stubs);
      const field = w.get('[data-cy="stub-field"]').element as HTMLInputElement;
      field.focus();
      const order: string[] = [];
      field.addEventListener('blur', () => order.push('blur'));
      vi.spyOn(doc, 'save').mockImplementation(async () => {
        order.push('save');
        return true;
      });
      window.dispatchEvent(key('s', { ctrlKey: true }));
      await flushPromises();
      expect(order).toEqual(['blur', 'save']);
      expect(document.activeElement).toBe(field);
    });

    it('shortcuts wait while the unsaved-changes question is open', async () => {
      const { pinia, doc, tree } = setupShellStores(exampleRecord());
      await mountShell(OstShell, pinia, stubs);
      await tree.patchNode('product-1', { title: 'Unsaved work' });
      await doc.request('new');
      const save = vi.spyOn(doc, 'save');
      window.dispatchEvent(key('s', { ctrlKey: true }));
      await flushPromises();
      expect(save).not.toHaveBeenCalled();
      expect(doc.pendingAction).toBe('new');
    });
  });

  describe('messages', () => {
    it('shows a failed file action as a toast that can be dismissed', async () => {
      const { pinia } = setupShellStores();
      io.pickFileToOpen.mockResolvedValue({ text: 'not json', fileName: 'x.txt', handle: null });
      const w = await mountShell(OstShell, pinia, stubs);
      await w.get('[data-cy="ost-empty-open"]').trigger('click');
      await flushPromises();
      const toast = w.get('[data-cy="ostError"]');
      expect(toast.attributes('role')).toBe('alert');
      expect(toast.text()).toContain('This file is not an Ombuto OST tree.');
      await w.get('[data-cy="ostErrorDismiss"]').trigger('click');
      expect(w.find('[data-cy="ostError"]').exists()).toBe(false);
    });

    it('shows a refused tree edit the same way', async () => {
      const { pinia, tree } = setupShellStores(exampleRecord());
      const w = await mountShell(OstShell, pinia, stubs);
      await tree.moveNode('solution-6', 'outcome-2');
      await flushPromises();
      expect(w.get('[data-cy="ostError"]').text()).toContain('That node cannot go there.');
      await w.get('[data-cy="ostErrorDismiss"]').trigger('click');
      expect(tree.error).toBeNull();
    });
  });
});
