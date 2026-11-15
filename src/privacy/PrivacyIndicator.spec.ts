import { afterEach, describe, expect, it, vi } from 'vitest';

import { enableAutoUnmount, flushPromises } from '@vue/test-utils';

import { memoryAutosave } from '@/doc/autosave';
import * as files from '@/doc/file-access';
import { exampleRecord, key, mountShell, setupShellStores } from '@/ost/shell/shell.test-util';

import PrivacyIndicator from './PrivacyIndicator.vue';
import source from './PrivacyIndicator.vue?raw';

vi.mock(import('@/doc/file-access'), async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, supportsFileHandles: vi.fn(() => false), downloadFile: vi.fn() };
});

enableAutoUnmount(afterEach);

/** Browser storage that refuses every write (full, or blocked in a private window). */
const refusingAutosave = () => ({ ...memoryAutosave(), save: () => Promise.reject(new Error('quota')) });

describe('PrivacyIndicator', () => {
  async function indicator(record: ReturnType<typeof exampleRecord> | null = null) {
    const ctx = setupShellStores(record);
    await ctx.doc.init();
    // The tokens and the dialog styles are scoped to .ost-root, as in the app.
    const host = { components: { PrivacyIndicator }, template: '<div class="ost-root"><PrivacyIndicator /></div>' };
    const w = await mountShell(host, ctx.pinia);
    const button = () => w.get('[data-cy="ost-privacy-indicator"]');
    const dialog = () => w.find('[data-cy="ostPrivacyDialog"]');
    return { ...ctx, w, button, dialog };
  }

  it('is a button that says where the tree is stored, with no document open too', async () => {
    const { button, dialog, w } = await indicator();
    expect(button().element.tagName).toBe('BUTTON');
    expect(button().text()).toBe('Stored on this device only');
    expect(button().attributes('aria-haspopup')).toBe('dialog');
    expect(button().classes()).not.toContain('is-warning');
    expect(w.get('[data-cy="ost-privacy-status"]').text()).toBe('');
    expect(dialog().exists()).toBe(false);
  });

  it('opens a labelled modal dialog that explains what is stored, what is sent and how to check', async () => {
    const { button, dialog } = await indicator();
    await button().trigger('click');
    expect(dialog().attributes('role')).toBe('dialog');
    expect(dialog().attributes('aria-modal')).toBe('true');
    const title = dialog().get(`#${dialog().attributes('aria-labelledby')}`);
    expect(title.text()).toBe('Your tree stays on this device');

    expect(
      dialog()
        .findAll('h3')
        .map(h => h.text()),
    ).toEqual(['What is stored', 'What is sent', 'How to check for yourself', 'Keep a file']);
    const text = dialog().text();
    expect(text).toContain('A working copy is kept in this browser');
    expect(text).toContain('no account, no analytics and no cookies');
    expect(text).toContain('Turn off your wifi and keep working');
    expect(text).toContain('Network tab');
    expect(text).toContain('Clearing your browsing data removes it');
    // Autosave works here: no warning, and no save button.
    expect(dialog().find('[data-cy="ost-privacy-autosave-off"]').exists()).toBe(false);
    expect(dialog().find('[data-cy="ost-privacy-save"]').exists()).toBe(false);
  });

  it('links to the source, in a new tab, without handing over the opener or the referrer', async () => {
    const { button, dialog } = await indicator();
    await button().trigger('click');
    const link = dialog().get('[data-cy="ost-privacy-source"]');
    expect(link.attributes('href')).toBe('https://github.com/FrancoisBotha/ombuto-ost');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
  });

  it('moves focus into the dialog, and Escape or Close puts it back on the indicator', async () => {
    const { button, dialog } = await indicator();
    (button().element as HTMLElement).focus();
    await button().trigger('click');
    await flushPromises();
    const close = dialog().get('[data-cy="ost-privacy-close"]');
    expect(document.activeElement).toBe(close.element);

    dialog().element.dispatchEvent(key('Escape'));
    await flushPromises();
    expect(dialog().exists()).toBe(false);
    expect(document.activeElement).toBe(button().element);

    await button().trigger('click');
    await flushPromises();
    await dialog().get('[data-cy="ost-privacy-close"]').trigger('click');
    expect(dialog().exists()).toBe(false);
    expect(document.activeElement).toBe(button().element);
  });

  it('never says "upload", and names the source of the app and nothing else on the web', () => {
    expect(source).not.toMatch(/upload/i);
    expect(source.match(/https?:\/\/[^\s"'<]+/g)).toEqual(['https://github.com/FrancoisBotha/ombuto-ost']);
  });

  describe('when the browser will not keep the working copy', () => {
    async function failing() {
      const ctx = await indicator(exampleRecord());
      ctx.doc.setAutosaveStore(refusingAutosave());
      await ctx.tree.patchNode('project-1', { title: 'Edited' });
      await ctx.doc.flushAutosave();
      await flushPromises();
      return ctx;
    }

    it('says that autosave is off and asks for a file, and announces it', async () => {
      const { button, w } = await failing();
      expect(button().text()).toBe('Autosave is off — save a file');
      expect(button().classes()).toContain('is-warning');
      const status = w.get('[data-cy="ost-privacy-status"]');
      expect(status.attributes('role')).toBe('status');
      expect(status.text()).toContain('Autosave is off');
    });

    it('explains it in the dialog and offers to save to the computer', async () => {
      const { button, dialog, doc } = await failing();
      await button().trigger('click');
      expect(dialog().get('[data-cy="ost-privacy-autosave-off"]').text()).toContain(
        'gone when this tab closes unless you save it to a file',
      );
      await dialog().get('[data-cy="ost-privacy-save"]').trigger('click');
      await flushPromises();
      expect(vi.mocked(files.downloadFile)).toHaveBeenCalledTimes(1);
      expect(doc.dirty).toBe(false);
      expect(dialog().exists()).toBe(false);
    });

    it('goes back to the usual wording once the browser stores the working copy again', async () => {
      const { button, doc, tree } = await failing();
      doc.setAutosaveStore(memoryAutosave());
      await tree.patchNode('project-1', { title: 'Edited again' });
      await doc.flushAutosave();
      await flushPromises();
      expect(button().text()).toBe('Stored on this device only');
      expect(button().classes()).not.toContain('is-warning');
    });

    it('says so from the start when the browser storage cannot even be read', async () => {
      const ctx = setupShellStores();
      ctx.doc.setAutosaveStore({ ...memoryAutosave(), load: () => Promise.reject(new Error('blocked')) });
      await ctx.doc.init();
      const w = await mountShell(PrivacyIndicator, ctx.pinia);
      expect(w.get('[data-cy="ost-privacy-indicator"]').text()).toBe('Autosave is off — save a file');
    });
  });
});
