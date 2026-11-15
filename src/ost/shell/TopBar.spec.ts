import { afterEach, describe, expect, it, vi } from 'vitest';

import { enableAutoUnmount, flushPromises } from '@vue/test-utils';

import * as files from '@/doc/file-access';

import TopBar from './TopBar.vue';
import { exampleRecord, mountShell, setupShellStores } from './shell.test-util';
import { matchShortcut, shortcutLabel } from './shortcuts';

vi.mock(import('@/doc/file-access'), async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, supportsFileHandles: vi.fn(() => false), pickFileToSave: vi.fn(), downloadFile: vi.fn() };
});

enableAutoUnmount(afterEach);
afterEach(() => {
  vi.clearAllMocks();
});

describe('TopBar', () => {
  async function bar(record = exampleRecord()) {
    const ctx = setupShellStores(record);
    await ctx.doc.init();
    const w = await mountShell(TopBar, ctx.pinia);
    const name = () => w.get('[data-cy="ost-doc-name"]');
    const value = () => (name().element as HTMLInputElement).value;
    return { ...ctx, w, name, value };
  }

  it('shows the brand, the File menu and the privacy indicator even with no document', async () => {
    const ctx = setupShellStores();
    await ctx.doc.init();
    const w = await mountShell(TopBar, ctx.pinia);
    expect(w.get('.ost-nav__brand').text()).toBe('Ombuto / OST');
    expect(w.find('[data-cy="ost-file-menu"]').exists()).toBe(true);
    expect(w.find('[data-cy="ost-privacy-indicator"]').exists()).toBe(true);
    expect(w.find('[data-cy="ost-doc-name"]').exists()).toBe(false);
    expect(w.find('[data-cy="ost-save-state"]').exists()).toBe(false);
  });

  describe('document name', () => {
    it('shows the name in a labelled field', async () => {
      const { name, value } = await bar();
      expect(value()).toBe('Example: meal-planning app');
      expect(name().attributes('aria-label')).toBe('Tree name');
    });

    it('commits on Enter (by blurring), cleaned, and that is a change to save', async () => {
      const { name, value, doc } = await bar();
      const input = name().element as HTMLInputElement;
      input.focus();
      await name().setValue('  Meals   v2  ');
      await name().trigger('keydown', { key: 'Enter' });
      expect(document.activeElement).not.toBe(input);
      expect(doc.name).toBe('Meals v2');
      expect(value()).toBe('Meals v2');
      expect(doc.dirty).toBe(true);
    });

    it('commits on blur; an unchanged name is not a change', async () => {
      const { name, doc } = await bar();
      await name().trigger('focus');
      await name().trigger('blur');
      expect(doc.dirty).toBe(false);
      await name().trigger('focus');
      await name().setValue('Renamed');
      await name().trigger('blur');
      expect(doc.name).toBe('Renamed');
    });

    it('Escape puts the name back and keeps focus in the field', async () => {
      const { name, value, doc } = await bar();
      const input = name().element as HTMLInputElement;
      input.focus();
      await name().setValue('Half typed');
      await name().trigger('keydown', { key: 'Escape' });
      expect(value()).toBe('Example: meal-planning app');
      expect(document.activeElement).toBe(input);
      await name().trigger('blur');
      expect(doc.name).toBe('Example: meal-planning app');
      expect(doc.dirty).toBe(false);
    });

    it('an emptied name falls back to the default rather than staying empty', async () => {
      const { name, value, doc } = await bar();
      await name().trigger('focus');
      await name().setValue('   ');
      await name().trigger('blur');
      expect(doc.name).toBe('Untitled tree');
      expect(value()).toBe('Untitled tree');
    });

    it('follows another document, but never overwrites what is being typed', async () => {
      const { name, value, doc } = await bar();
      await doc.request('new');
      await flushPromises();
      expect(value()).toBe('Untitled tree');
      await name().trigger('focus');
      await name().setValue('Typing');
      doc.rename('Changed elsewhere');
      await flushPromises();
      expect(value()).toBe('Typing');
    });
  });

  describe('saved / unsaved state', () => {
    it('says nothing for a clean document that has no file yet', async () => {
      const { w } = await bar();
      expect(w.get('[data-cy="ost-save-state"]').text()).toBe('');
    });

    it('says "Unsaved changes" after an edit, explaining where the changes are kept', async () => {
      const { w, tree } = await bar();
      await tree.patchNode('project-1', { title: 'Edited' });
      await flushPromises();
      const state = w.get('[data-cy="ost-save-state"]');
      expect(state.text()).toBe('Unsaved changes');
      expect(state.classes()).toContain('is-dirty');
      expect(state.attributes('role')).toBe('status');
      expect(w.get('[data-cy="ost-save-now"]').attributes('title')).toContain('kept in this browser');
    });

    describe('the unsaved state is a button that saves', () => {
      const saveNow = (w: Awaited<ReturnType<typeof bar>>['w']) => w.find('[data-cy="ost-save-now"]');

      it('is a button only while there are unsaved changes, named for what it does', async () => {
        const { w, tree } = await bar();
        expect(saveNow(w).exists()).toBe(false);
        expect(w.find('[data-cy="ost-save-state"] button').exists()).toBe(false);

        await tree.patchNode('project-1', { title: 'Edited' });
        await flushPromises();
        const button = saveNow(w);
        expect(button.element.tagName).toBe('BUTTON');
        expect(button.attributes('type')).toBe('button');
        expect(button.attributes('aria-label')).toBe('Unsaved changes — save now');
        expect(button.attributes('title')).toMatch(/Click to save now \(Ctrl\+S\)/);
        expect(button.attributes('disabled')).toBeUndefined();
        expect(button.classes()).toContain('ost-hit');
        expect(w.html()).not.toMatch(/upload/i);
      });

      it('a click saves through the document store, once, and the state becomes plain text again', async () => {
        const { w, tree, doc } = await bar();
        await tree.patchNode('project-1', { title: 'Edited' });
        await flushPromises();
        const save = vi.spyOn(doc, 'save');
        await saveNow(w).trigger('click');
        await flushPromises();
        expect(save).toHaveBeenCalledTimes(1);
        expect(vi.mocked(files.downloadFile)).toHaveBeenCalledTimes(1);
        expect(doc.dirty).toBe(false);
        expect(saveNow(w).exists()).toBe(false);
        const text = w.get('[data-cy="ost-save-text"]');
        expect(text.element.tagName).toBe('SPAN');
        expect(text.text()).toBe('Downloaded a copy');
      });

      it('a second click while the first save is still choosing a file does not start another', async () => {
        const { w, tree, doc } = await bar();
        vi.mocked(files.supportsFileHandles).mockReturnValueOnce(true).mockReturnValueOnce(true);
        let choose!: (handle: FileSystemFileHandle | null) => void;
        vi.mocked(files.pickFileToSave).mockReturnValue(new Promise(resolve => (choose = resolve)));
        await tree.patchNode('project-1', { title: 'Edited' });
        await flushPromises();
        const save = vi.spyOn(doc, 'save');
        const button = saveNow(w);
        await button.trigger('click');
        await button.trigger('click');
        await flushPromises();
        expect(save).toHaveBeenCalledTimes(1);
        expect(vi.mocked(files.pickFileToSave)).toHaveBeenCalledTimes(1);
        expect(button.attributes('aria-busy')).toBe('true');

        choose(null); // the picker was dismissed: still unsaved, and the button works again
        await flushPromises();
        expect(doc.dirty).toBe(true);
        expect(saveNow(w).attributes('aria-busy')).toBeUndefined();
        vi.mocked(files.pickFileToSave).mockResolvedValue({ name: 'meals.ost', kind: 'file' } as unknown as FileSystemFileHandle);
        await saveNow(w).trigger('click');
        await flushPromises();
        expect(save).toHaveBeenCalledTimes(2);
        expect(w.get('[data-cy="ost-save-text"]').text()).toBe('Saved');
      });

      it('keeps the keyboard focus in the bar when the button it was on goes away', async () => {
        const { w, tree } = await bar();
        await tree.patchNode('project-1', { title: 'Edited' });
        await flushPromises();
        const button = saveNow(w);
        (button.element as HTMLElement).focus();
        await button.trigger('click');
        await flushPromises();
        expect(document.activeElement).toBe(w.get('[data-cy="ost-save-state"]').element);
      });
    });

    it('says "Downloaded a copy" after a save that could only download: the app cannot know it arrived', async () => {
      const { w, tree, doc } = await bar();
      await tree.patchNode('project-1', { title: 'Edited' });
      await doc.save();
      await flushPromises();
      const state = w.get('[data-cy="ost-save-state"]');
      expect(state.text()).toBe('Downloaded a copy');
      expect(state.classes()).not.toContain('is-dirty');
      expect(w.get('[data-cy="ost-save-text"]').attributes('title')).toMatch(
        /downloads as Example meal-planning app\.ost at \d.*cannot see whether it arrived/,
      );
      expect(vi.mocked(files.downloadFile)).toHaveBeenCalledTimes(1);
    });

    it('says "Saved" with the file name once written to a file the user chose', async () => {
      const { w, tree, doc } = await bar();
      vi.mocked(files.supportsFileHandles).mockReturnValueOnce(true);
      vi.mocked(files.pickFileToSave).mockResolvedValue({ name: 'meals.ost', kind: 'file' } as unknown as FileSystemFileHandle);
      await tree.patchNode('project-1', { title: 'Edited' });
      await doc.save();
      await flushPromises();
      const state = w.get('[data-cy="ost-save-state"]');
      expect(state.text()).toBe('Saved');
      expect(w.get('[data-cy="ost-save-text"]').attributes('title')).toMatch(/^Saved to meals\.ost at \d/);
    });

    it('a restored document keeps its unsaved state across a reload', async () => {
      const { w } = await bar(exampleRecord({ dirty: true, fileName: 'meals.ost' }));
      expect(w.get('[data-cy="ost-save-state"]').text()).toBe('Unsaved changes');
    });
  });
});

describe('document shortcuts', () => {
  const press = (keyName: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) =>
    matchShortcut({ key: keyName, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it('recognises save, save as and open with Ctrl or Cmd, in either letter case', () => {
    expect(press('s', { ctrlKey: true })).toBe('save');
    expect(press('S', { metaKey: true })).toBe('save');
    expect(press('S', { ctrlKey: true, shiftKey: true })).toBe('saveAs');
    expect(press('o', { metaKey: true })).toBe('open');
    expect(press('O', { ctrlKey: true })).toBe('open');
  });

  it('ignores everything else', () => {
    expect(press('s')).toBeNull();
    expect(press('s', { altKey: true, ctrlKey: true })).toBeNull();
    expect(press('o', { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press('p', { ctrlKey: true })).toBeNull();
    expect(press('Enter', { ctrlKey: true })).toBeNull();
  });

  it('writes the shortcut the way the platform does', () => {
    expect(shortcutLabel('S')).toBe('Ctrl+S');
    expect(shortcutLabel('S', true)).toBe('Ctrl+Shift+S');
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(shortcutLabel('O')).toBe('⌘O');
    expect(shortcutLabel('S', true)).toBe('⇧⌘S');
    vi.unstubAllGlobals();
  });
});
