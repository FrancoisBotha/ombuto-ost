import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type VueWrapper, enableAutoUnmount, flushPromises } from '@vue/test-utils';

import { registerPendingEdit } from '@/doc/pending-edits';
import * as exporters from '@/export';

import EmptyState from './EmptyState.vue';
import FileMenu from './FileMenu.vue';
import { exampleRecord, mountShell, setupShellStores } from './shell.test-util';

vi.mock('@/export', () => ({
  exportPng: vi.fn(async () => undefined),
  exportSvg: vi.fn(async () => undefined),
  exportMarkdown: vi.fn(async () => undefined),
}));

const exp = vi.mocked(exporters);

enableAutoUnmount(afterEach);

const cy = (w: VueWrapper, name: string) => w.get(`[data-cy="${name}"]`);
const press = (w: VueWrapper, name: string, keyName: string) => cy(w, name).trigger('keydown', { key: keyName });
const focused = () => (document.activeElement as HTMLElement | null)?.getAttribute('data-cy');

describe('FileMenu', () => {
  beforeEach(() => vi.clearAllMocks());

  /** A menu with the example document open (so nothing is disabled). */
  async function withDocument() {
    const ctx = setupShellStores(exampleRecord());
    await ctx.doc.init();
    const w = await mountShell(FileMenu, ctx.pinia);
    return { ...ctx, w };
  }

  async function openMenu(w: VueWrapper) {
    await cy(w, 'ost-file-menu').trigger('click');
    await flushPromises();
  }

  it('is a menu button: closed at first, opens with New, Open file, Open example, Save, Save as and Export', async () => {
    const { w } = await withDocument();
    const button = cy(w, 'ost-file-menu');
    expect(button.attributes('aria-haspopup')).toBe('menu');
    expect(button.attributes('aria-expanded')).toBe('false');
    expect(w.find('[data-cy="ost-file-menu-list"]').exists()).toBe(false);

    await openMenu(w);
    expect(button.attributes('aria-expanded')).toBe('true');
    const list = cy(w, 'ost-file-menu-list');
    expect(list.attributes('role')).toBe('menu');
    const labels = list
      .findAll(':scope > [role="menuitem"], :scope > .ost-file-menu__sub > [role="menuitem"]')
      .map(i => i.find('span').text());
    expect(labels).toEqual(['New tree', 'Open file…', 'Open example', 'Save', 'Save as…', 'Export']);
    // Focus moves into the menu.
    expect(focused()).toBe('ost-file-new');
  });

  it('shows the shortcuts next to Open, Save and Save as', async () => {
    const { w } = await withDocument();
    await openMenu(w);
    expect(cy(w, 'ost-file-open').find('kbd').text()).toBe('Ctrl+O');
    expect(cy(w, 'ost-file-save').find('kbd').text()).toBe('Ctrl+S');
    expect(cy(w, 'ost-file-save-as').find('kbd').text()).toBe('Ctrl+Shift+S');
  });

  it('never says "upload"; Save says where it saves', async () => {
    const { w, doc } = await withDocument();
    await openMenu(w);
    expect(cy(w, 'ost-file-menu-list').html().toLowerCase()).not.toContain('upload');
    expect(cy(w, 'ost-file-save').attributes('title')).toBe('Save to your computer');
    expect(doc.savesInPlace).toBe(false);
  });

  it('each item runs its action and closes the menu, handing focus back to the button', async () => {
    const { w, doc } = await withDocument();
    const request = vi.spyOn(doc, 'request').mockResolvedValue(undefined);
    const save = vi.spyOn(doc, 'save').mockResolvedValue(true);
    const saveAs = vi.spyOn(doc, 'saveAs').mockResolvedValue(true);
    for (const item of ['ost-file-new', 'ost-file-open', 'ost-file-example', 'ost-file-save', 'ost-file-save-as']) {
      await openMenu(w);
      await cy(w, item).trigger('click');
      expect(w.find('[data-cy="ost-file-menu-list"]').exists(), item).toBe(false);
      expect(focused(), item).toBe('ost-file-menu');
    }
    expect(request.mock.calls.map(c => c[0])).toEqual(['new', 'open', 'example']);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saveAs).toHaveBeenCalledTimes(1);
  });

  it('with no document open, Save, Save as and Export are disabled; New, Open and Open example still work', async () => {
    const ctx = setupShellStores();
    await ctx.doc.init();
    const w = await mountShell(FileMenu, ctx.pinia);
    await openMenu(w);
    for (const item of ['ost-file-save', 'ost-file-save-as', 'ost-file-export']) {
      expect(cy(w, item).attributes('disabled'), item).toBeDefined();
    }
    expect(cy(w, 'ost-file-new').attributes('disabled')).toBeUndefined();
    expect(cy(w, 'ost-file-open').attributes('disabled')).toBeUndefined();
    expect(cy(w, 'ost-file-example').attributes('disabled')).toBeUndefined();
    // Arrow keys skip what is disabled.
    await press(w, 'ost-file-menu-list', 'End');
    expect(focused()).toBe('ost-file-example');
  });

  describe('Open example', () => {
    it('is worded like the button on the empty state', async () => {
      const { w } = await withDocument();
      await openMenu(w);
      expect(cy(w, 'ost-file-example').find('span').text()).toBe('Open example');
      const empty = await mountShell(EmptyState, setupShellStores().pinia);
      expect(empty.get('[data-cy="ost-empty-example"]').text()).toBe('Open example');
    });

    it('opens the built-in example as an unsaved tree that belongs to no file', async () => {
      const ctx = setupShellStores();
      await ctx.doc.init();
      const w = await mountShell(FileMenu, ctx.pinia);
      await openMenu(w);
      await cy(w, 'ost-file-example').trigger('click');
      await flushPromises();
      expect(ctx.doc.hasDocument).toBe(true);
      expect(ctx.doc.name).toBe('Example: meal-planning app');
      expect(ctx.doc.fileName).toBeNull();
      expect(ctx.doc.savesInPlace).toBe(false);
      expect(ctx.doc.lastSavedAt).toBeNull();
      expect(ctx.doc.dirty).toBe(false);
      expect(ctx.doc.pendingAction).toBeNull();
      // The example shows the nesting: one top-level project holding sub-projects.
      expect(ctx.tree.roots.map(p => p.title)).toEqual(['Meal-planning app']);
      expect(ctx.tree.projects.filter(p => p.parent === 'project-1').map(p => p.title)).toEqual(['Weekly planner', 'Shopping list']);
    });

    it('replaces a saved, unchanged tree without asking, and lets go of its file', async () => {
      const ctx = setupShellStores(exampleRecord({ fileName: 'meals.ost', savedAt: '2026-01-01T10:00:00.000Z' }));
      await ctx.doc.init();
      expect(ctx.doc.fileName).toBe('meals.ost');
      expect(ctx.doc.dirty).toBe(false);
      const w = await mountShell(FileMenu, ctx.pinia);
      await openMenu(w);
      await cy(w, 'ost-file-example').trigger('click');
      await flushPromises();
      expect(ctx.doc.pendingAction).toBeNull();
      expect(ctx.doc.hasDocument).toBe(true);
      expect(ctx.doc.fileName).toBeNull();
      expect(ctx.doc.lastSavedAt).toBeNull();
      expect(ctx.doc.dirty).toBe(false);
    });

    it('with unsaved changes it waits for the unsaved-changes answer: Cancel keeps the tree, discard opens the example', async () => {
      const { w, doc, tree } = await withDocument();
      await tree.patchNode('project-1', { title: 'Unsaved work' });
      expect(doc.dirty).toBe(true);
      await openMenu(w);
      await cy(w, 'ost-file-example').trigger('click');
      await flushPromises();
      expect(doc.pendingAction).toBe('example');
      expect(tree.byId('project-1')?.title).toBe('Unsaved work');

      await doc.resolvePending('cancel');
      expect(doc.pendingAction).toBeNull();
      expect(tree.byId('project-1')?.title).toBe('Unsaved work');
      expect(doc.dirty).toBe(true);

      await openMenu(w);
      await cy(w, 'ost-file-example').trigger('click');
      await flushPromises();
      await doc.resolvePending('discard');
      expect(tree.byId('project-1')?.title).toBe('Meal-planning app');
      expect(doc.dirty).toBe(false);
      expect(doc.fileName).toBeNull();
    });

    it('text still being typed counts as an unsaved change: it is taken in, and the user is asked', async () => {
      const { w, doc, tree } = await withDocument();
      const unregister = registerPendingEdit(() => void tree.patchNode('project-1', { note: 'typed, not blurred' }));
      await openMenu(w);
      await cy(w, 'ost-file-example').trigger('click');
      await flushPromises();
      unregister();
      expect(tree.byId('project-1')?.note).toBe('typed, not blurred');
      expect(doc.pendingAction).toBe('example');
    });
  });

  describe('keyboard', () => {
    it('Arrow Down on the button opens the menu', async () => {
      const { w } = await withDocument();
      await press(w, 'ost-file-menu', 'ArrowDown');
      await flushPromises();
      expect(focused()).toBe('ost-file-new');
    });

    it('arrows move and wrap, Home / End jump', async () => {
      const { w } = await withDocument();
      await openMenu(w);
      await press(w, 'ost-file-menu-list', 'ArrowDown');
      expect(focused()).toBe('ost-file-open');
      await press(w, 'ost-file-menu-list', 'End');
      expect(focused()).toBe('ost-file-export');
      await press(w, 'ost-file-menu-list', 'ArrowDown');
      expect(focused()).toBe('ost-file-new');
      await press(w, 'ost-file-menu-list', 'ArrowUp');
      expect(focused()).toBe('ost-file-export');
      await press(w, 'ost-file-menu-list', 'Home');
      expect(focused()).toBe('ost-file-new');
    });

    it('Escape closes and returns focus to the button; Tab closes and lets focus move on', async () => {
      const { w } = await withDocument();
      await openMenu(w);
      await press(w, 'ost-file-menu-list', 'Escape');
      expect(w.find('[data-cy="ost-file-menu-list"]').exists()).toBe(false);
      expect(focused()).toBe('ost-file-menu');
      await openMenu(w);
      await press(w, 'ost-file-menu-list', 'Tab');
      expect(w.find('[data-cy="ost-file-menu-list"]').exists()).toBe(false);
    });

    it('a press outside closes the menu; a press inside does not', async () => {
      const { w } = await withDocument();
      await openMenu(w);
      cy(w, 'ost-file-save').element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await flushPromises();
      expect(w.find('[data-cy="ost-file-menu-list"]').exists()).toBe(true);
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await flushPromises();
      expect(w.find('[data-cy="ost-file-menu-list"]').exists()).toBe(false);
    });
  });

  describe('Export submenu', () => {
    async function openExport(w: VueWrapper) {
      await openMenu(w);
      await cy(w, 'ost-file-export').trigger('click');
      await flushPromises();
    }

    it('opens from Export with PNG, SVG and Markdown, and takes focus', async () => {
      const { w } = await withDocument();
      await openMenu(w);
      const item = cy(w, 'ost-file-export');
      expect(item.attributes('aria-haspopup')).toBe('menu');
      expect(item.attributes('aria-expanded')).toBe('false');
      expect(w.find('[data-cy="ost-file-export-list"]').exists()).toBe(false);
      await item.trigger('click');
      await flushPromises();
      expect(item.attributes('aria-expanded')).toBe('true');
      const sub = cy(w, 'ost-file-export-list');
      expect(sub.attributes('role')).toBe('menu');
      expect(sub.findAll('[role="menuitem"]').map(i => i.text())).toEqual(['PNG image', 'SVG image', 'Markdown outline']);
      expect(focused()).toBe('ost-file-export-png');
    });

    it('a second click on Export keeps it open (a mouse has already opened it by hovering)', async () => {
      const { w } = await withDocument();
      await openExport(w);
      await cy(w, 'ost-file-export').trigger('click');
      await flushPromises();
      expect(w.find('[data-cy="ost-file-export-list"]').exists()).toBe(true);
    });

    it('Arrow Right or Enter on Export opens it; Arrow Left or Escape goes back to Export only', async () => {
      const { w } = await withDocument();
      await openMenu(w);
      await press(w, 'ost-file-export', 'ArrowRight');
      await flushPromises();
      expect(focused()).toBe('ost-file-export-png');
      await press(w, 'ost-file-export-list', 'ArrowDown');
      expect(focused()).toBe('ost-file-export-svg');
      await press(w, 'ost-file-export-list', 'ArrowLeft');
      expect(w.find('[data-cy="ost-file-export-list"]').exists()).toBe(false);
      expect(w.find('[data-cy="ost-file-menu-list"]').exists()).toBe(true);
      expect(focused()).toBe('ost-file-export');
      await press(w, 'ost-file-export', 'Enter');
      await flushPromises();
      await press(w, 'ost-file-export-list', 'Escape');
      expect(w.find('[data-cy="ost-file-menu-list"]').exists()).toBe(true);
      expect(focused()).toBe('ost-file-export');
    });

    it('the arrow keys of the main menu skip the submenu items', async () => {
      const { w } = await withDocument();
      await openExport(w);
      (cy(w, 'ost-file-save-as').element as HTMLElement).focus();
      await press(w, 'ost-file-menu-list', 'ArrowDown');
      expect(focused()).toBe('ost-file-export');
      await press(w, 'ost-file-menu-list', 'ArrowDown');
      expect(focused()).toBe('ost-file-new');
    });

    it.each([
      ['png', 'exportPng'],
      ['svg', 'exportSvg'],
      ['markdown', 'exportMarkdown'],
    ] as const)('%s calls %s() with no arguments and closes the menu', async (id, fn) => {
      const { w } = await withDocument();
      await openExport(w);
      await cy(w, `ost-file-export-${id}`).trigger('click');
      await flushPromises();
      expect(exp[fn]).toHaveBeenCalledTimes(1);
      expect(exp[fn]).toHaveBeenCalledWith();
      expect(w.find('[data-cy="ost-file-menu-list"]').exists()).toBe(false);
      expect(focused()).toBe('ost-file-menu');
    });

    it('a failed export is reported with its message', async () => {
      const { w, doc } = await withDocument();
      exp.exportSvg.mockRejectedValueOnce(new Error('SVG export is not available yet.'));
      await openExport(w);
      await cy(w, 'ost-file-export-svg').trigger('click');
      await flushPromises();
      expect(doc.error).toBe('SVG export is not available yet.');
    });

    it('a failure without a message gets a plain one', async () => {
      const { w, doc } = await withDocument();
      exp.exportPng.mockRejectedValueOnce('nope');
      await openExport(w);
      await cy(w, 'ost-file-export-png').trigger('click');
      await flushPromises();
      expect(doc.error).toBe('The PNG image could not be exported.');
    });
  });
});
