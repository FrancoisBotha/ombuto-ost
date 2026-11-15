import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

import { type VueWrapper, flushPromises } from '@vue/test-utils';

import type { AutosaveRecord } from '@/doc/autosave';
import { smallDocument } from '@/doc/small-document.test-util';

import { key, mountShell, setupShellStores } from './shell.test-util';
import { isTextEntry, matchShortcut, useDocumentShortcuts } from './shortcuts';

const record = (): AutosaveRecord => ({ doc: smallDocument(), dirty: false, fileName: null, handle: null, savedAt: null });

/** A page with the shortcuts on, and one of everything a key press can come from. */
const Host = defineComponent({
  setup() {
    useDocumentShortcuts();
    return () =>
      h('div', [
        h('input', { 'data-cy': 'text', type: 'text' }),
        h('input', { 'data-cy': 'search', type: 'search' }),
        h('textarea', { 'data-cy': 'area' }),
        h('div', { 'data-cy': 'editable', contenteditable: 'true', tabindex: '0' }),
        h('input', { 'data-cy': 'tick', type: 'checkbox' }),
        h('button', { 'data-cy': 'button', type: 'button' }, 'A button'),
        h('div', { 'data-cy': 'node', tabindex: '0' }, 'A node'),
      ]);
  },
});

describe('undo and redo shortcuts', () => {
  const press = (keyName: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) =>
    matchShortcut({ key: keyName, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it('Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo', () => {
    expect(press('z', { ctrlKey: true })).toBe('undo');
    expect(press('Z', { metaKey: true })).toBe('undo');
    expect(press('Z', { ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(press('z', { metaKey: true, shiftKey: true })).toBe('redo');
    expect(press('y', { ctrlKey: true })).toBe('redo');
  });

  it('ignores Z and Y without Ctrl/Cmd, with Alt, and Cmd+Y (the browser history on a Mac)', () => {
    expect(press('z')).toBeNull();
    expect(press('y')).toBeNull();
    expect(press('z', { ctrlKey: true, altKey: true })).toBeNull();
    expect(press('y', { metaKey: true })).toBeNull();
    expect(press('y', { ctrlKey: true, shiftKey: true })).toBeNull();
  });

  describe('where the keys are pressed', () => {
    let wrapper: VueWrapper | null = null;

    afterEach(() => {
      wrapper?.unmount();
      wrapper = null;
      document.body.innerHTML = '';
    });

    async function setup() {
      const ctx = setupShellStores(record());
      await ctx.doc.init();
      wrapper = await mountShell(Host, ctx.pinia);
      await ctx.tree.patchNode('project-1', { title: 'Edited' });
      const undo = vi.spyOn(ctx.doc, 'undo');
      const redo = vi.spyOn(ctx.doc, 'redo');
      /** Presses a key with the focus on `cy`; true when the app took the key from the browser. */
      const pressOn = async (cy: string, name: string, init: KeyboardEventInit = { ctrlKey: true }) => {
        const el = wrapper!.get(`[data-cy="${cy}"]`).element as HTMLElement;
        el.focus();
        const event = key(name, init);
        el.dispatchEvent(event);
        await flushPromises();
        return event.defaultPrevented;
      };
      return { ...ctx, undo, redo, pressOn };
    }

    it('isTextEntry: text fields, text areas and editable text — not tick boxes, buttons or nodes', async () => {
      await setup();
      const el = (cy: string) => wrapper!.get(`[data-cy="${cy}"]`).element;
      expect(['text', 'search', 'area'].map(cy => isTextEntry(el(cy)))).toEqual([true, true, true]);
      const editable = el('editable') as HTMLElement;
      // happy-dom does not derive isContentEditable from the attribute.
      Object.defineProperty(editable, 'isContentEditable', { value: true });
      expect(isTextEntry(editable)).toBe(true);
      expect(['tick', 'button', 'node'].map(cy => isTextEntry(el(cy)))).toEqual([false, false, false]);
      expect(isTextEntry(null)).toBe(false);
      expect(isTextEntry(window)).toBe(false);
    });

    it('on a node, a button or a tick box they undo and redo the tree, and the browser does not get the key', async () => {
      const { tree, undo, redo, pressOn } = await setup();
      expect(await pressOn('node', 'z')).toBe(true);
      expect(undo).toHaveBeenCalledTimes(1);
      expect(tree.byId('project-1')!.title).toBe('Meal-planning app');

      expect(await pressOn('button', 'y')).toBe(true);
      expect(redo).toHaveBeenCalledTimes(1);
      expect(tree.byId('project-1')!.title).toBe('Edited');

      expect(await pressOn('tick', 'Z', { metaKey: true })).toBe(true);
      expect(await pressOn('node', 'Z', { ctrlKey: true, shiftKey: true })).toBe(true);
      expect(undo).toHaveBeenCalledTimes(2);
      expect(redo).toHaveBeenCalledTimes(2);
      expect(tree.byId('project-1')!.title).toBe('Edited');
    });

    it('in a text field they are left to the browser: the field undoes its own text and the tree is not touched', async () => {
      const { tree, undo, redo, pressOn } = await setup();
      for (const cy of ['text', 'search', 'area']) {
        expect(await pressOn(cy, 'z')).toBe(false);
        expect(await pressOn(cy, 'y')).toBe(false);
        expect(await pressOn(cy, 'z', { ctrlKey: true, shiftKey: true })).toBe(false);
      }
      expect(undo).not.toHaveBeenCalled();
      expect(redo).not.toHaveBeenCalled();
      expect(tree.byId('project-1')!.title).toBe('Edited');
    });

    it('takes the key even with nothing to undo, so the browser never reaches into a field that lost the focus', async () => {
      const { doc, pressOn } = await setup();
      await doc.undo();
      expect(doc.undoLabel).toBeNull();
      expect(await pressOn('node', 'z')).toBe(true);
    });

    it('does nothing under the delete confirmation or the unsaved-changes question', async () => {
      const { doc, ui, tree, undo, pressOn } = await setup();
      ui.askDelete('opportunity-3');
      expect(await pressOn('node', 'z')).toBe(true);
      expect(undo).not.toHaveBeenCalled();
      ui.cancelDelete();

      await doc.request('new');
      expect(doc.pendingAction).toBe('new');
      expect(await pressOn('node', 'z')).toBe(true);
      expect(undo).not.toHaveBeenCalled();
      expect(tree.byId('project-1')!.title).toBe('Edited');
    });

    it('leaving a text field ends the undo step being typed; leaving a button does not', async () => {
      const { doc } = await setup();
      const seal = vi.spyOn(doc, 'sealHistory');
      const out = (cy: string) => wrapper!.get(`[data-cy="${cy}"]`).element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      out('button');
      out('node');
      expect(seal).not.toHaveBeenCalled();
      out('text');
      out('area');
      expect(seal).toHaveBeenCalledTimes(2);
    });

    it('a rename on the canvas that closes without a blur (Enter, Escape) ends the step too', async () => {
      const { doc, ui } = await setup();
      const seal = vi.spyOn(doc, 'sealHistory');
      ui.startEditing('project-1');
      await flushPromises();
      expect(seal).not.toHaveBeenCalled();
      ui.stopEditing();
      await flushPromises();
      expect(seal).toHaveBeenCalledTimes(1);
    });
  });
});
