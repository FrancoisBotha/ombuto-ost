/*
 * Text typed into a field reaches the document without a blur: a moment after typing stops, and at
 * once when something flushes the pending edits. Escape, where a field has it, still undoes.
 */
import { defineComponent, h } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';

import NodeTitleEditor from '@/ost/canvas/NodeTitleEditor.vue';
import DetailPanel from '@/ost/panel/DetailPanel.vue';
import LinkRow from '@/ost/panel/fields/LinkRow.vue';
import NotesField from '@/ost/panel/fields/NotesField.vue';
import OwnerField from '@/ost/panel/fields/OwnerField.vue';
import { mountWith, setupStores } from '@/ost/panel/panel.test-util';
import { exampleRecord, mountShell, setupShellStores } from '@/ost/shell/shell.test-util';
import TopBar from '@/ost/shell/TopBar.vue';

import { LIVE_COMMIT_DELAY_MS, flushPendingEdits, registerPendingEdit, useLiveCommit } from './pending-edits';

enableAutoUnmount(afterEach);

describe('pending edits', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('flushPendingEdits runs every registered flush, and one failing field does not stop the rest', () => {
    const calls: string[] = [];
    const a = registerPendingEdit(() => {
      throw new Error('field broke');
    });
    const b = registerPendingEdit(() => calls.push('b'));
    flushPendingEdits();
    expect(calls).toEqual(['b']);
    a();
    b();
    flushPendingEdits();
    expect(calls).toEqual(['b']);
  });

  it('useLiveCommit commits once, a moment after the last key press; flush commits at once; cancel drops it', () => {
    const commit = vi.fn();
    let live!: ReturnType<typeof useLiveCommit>;
    const wrapper = mount(
      defineComponent({
        setup() {
          live = useLiveCommit(commit);
          return () => h('div');
        },
      }),
    );
    live.touch();
    vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS - 1);
    live.touch();
    vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);

    live.touch();
    flushPendingEdits();
    expect(commit).toHaveBeenCalledTimes(2);
    flushPendingEdits(); // nothing waiting
    vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS);
    expect(commit).toHaveBeenCalledTimes(2);

    live.touch();
    live.cancel();
    vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS);
    expect(commit).toHaveBeenCalledTimes(2);

    // A commit still waiting when the field goes away is made, and the field is unregistered.
    live.touch();
    wrapper.unmount();
    expect(commit).toHaveBeenCalledTimes(3);
    flushPendingEdits();
    expect(commit).toHaveBeenCalledTimes(3);
  });

  describe('NotesField', () => {
    it('saves what is typed without a blur, and leaves the text in the field alone', async () => {
      const wrapper = mount(NotesField, { props: { value: 'Before' }, attachTo: document.body });
      const area = wrapper.get('[data-cy="ost-notes"]');
      await area.trigger('focus');
      await area.setValue('Before and more');
      expect(wrapper.emitted('change')).toBeUndefined();
      vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS);
      expect(wrapper.emitted('change')?.[0][0]).toBe('Before and more');
      // The store answers with the saved value: the focused field is not rewritten.
      await wrapper.setProps({ value: 'Before and more' });
      await area.setValue('Before and more, still typing');
      expect((area.element as HTMLTextAreaElement).value).toBe('Before and more, still typing');
      // A flush (Save, Open, the page closing) takes the rest at once.
      flushPendingEdits();
      expect(wrapper.emitted('change')?.[1][0]).toBe('Before and more, still typing');
      // The blur has nothing new to send.
      await wrapper.setProps({ value: 'Before and more, still typing' });
      await area.trigger('blur');
      expect(wrapper.emitted('change')).toHaveLength(2);
    });
  });

  describe('OwnerField', () => {
    it('saves while typing; Escape puts back the owner from before the edit', async () => {
      const wrapper = mount(OwnerField, { props: { value: 'Kira P' }, attachTo: document.body });
      const input = wrapper.get('[data-cy="ost-owner"]');
      await input.trigger('focus');
      await input.setValue('Kira P and Sam ');
      vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS);
      expect(wrapper.emitted('change')).toEqual([['Kira P and Sam']]);
      expect((input.element as HTMLInputElement).value).toBe('Kira P and Sam '); // not trimmed under the caret
      await wrapper.setProps({ value: 'Kira P and Sam' });
      await input.trigger('keydown', { key: 'Escape' });
      expect(wrapper.emitted('change')?.[1]).toEqual(['Kira P']);
      expect((input.element as HTMLInputElement).value).toBe('Kira P');
    });
  });

  describe('LinkRow', () => {
    const link = { id: 1, name: 'Notes', url: 'https://example.com/notes' };

    it('saves a valid name or URL while typing, never an invalid one, and Escape undoes both', async () => {
      const wrapper = mount(LinkRow, { props: { link }, attachTo: document.body });
      const url = wrapper.get('[data-cy="ost-link-url"]');
      await url.trigger('focus');
      await url.setValue('javascript:alert(1)');
      vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS);
      expect(wrapper.emitted('save')).toBeUndefined();
      expect(wrapper.find('[data-cy="ost-link-error"]').exists()).toBe(false); // no scolding mid-word
      await url.setValue('https://example.com/new');
      flushPendingEdits();
      expect(wrapper.emitted('save')).toEqual([[{ url: 'https://example.com/new' }]]);
      await wrapper.setProps({ link: { ...link, url: 'https://example.com/new' } });
      await url.trigger('keydown', { key: 'Escape' });
      expect(wrapper.emitted('save')?.[1]).toEqual([{ url: 'https://example.com/notes' }]);

      const name = wrapper.get('[data-cy="ost-link-name"]');
      await name.trigger('focus');
      await name.setValue('   ');
      vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS);
      expect(wrapper.emitted('save')).toHaveLength(2);
    });
  });

  describe('panel title', () => {
    it('saves a valid title while typing, to the node it was typed for; Escape restores the title', async () => {
      const ctx = await setupStores();
      ctx.service.patchNode.callsFake(
        async (_type, id, body) => ({ ...(await ctx.service.getTree()).find(n => n.id === id && n.type === 'OUTCOME')!, ...body }) as never,
      );
      ctx.ui.select('outcome-1');
      const wrapper = await mountWith(DetailPanel, ctx.pinia);
      const title = wrapper.get('[data-cy="ost-panel-title"]');
      await title.trigger('focus');
      await title.setValue('W');
      vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS);
      expect(ctx.service.patchNode.called).toBe(false); // too short to be a title yet
      await title.setValue('Weekly interviews, every team');
      vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS);
      await flushPromises();
      expect(ctx.service.patchNode.lastCall.args).toEqual(['outcome', 1, { title: 'Weekly interviews, every team' }]);
      expect((title.element as HTMLInputElement).value).toBe('Weekly interviews, every team');

      await title.trigger('keydown', { key: 'Escape' });
      await flushPromises();
      expect(ctx.service.patchNode.lastCall.args).toEqual(['outcome', 1, { title: 'Weekly interviews' }]);
      expect((title.element as HTMLInputElement).value).toBe('Weekly interviews');

      // Typed, then another node is selected before the commit: it goes to the node it was typed for.
      await title.setValue('Typed for the outcome');
      ctx.ui.select('solution-1');
      await flushPromises();
      expect(ctx.service.patchNode.lastCall.args).toEqual(['outcome', 1, { title: 'Typed for the outcome' }]);
    });
  });

  describe('document name', () => {
    it('renames while typing; an emptied field waits for blur; Escape restores the name', async () => {
      const ctx = setupShellStores(exampleRecord());
      await ctx.doc.init();
      const w = await mountShell(TopBar, ctx.pinia);
      const name = w.get('[data-cy="ost-doc-name"]');
      await name.trigger('focus');
      await name.setValue('Meal planning 2027');
      vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS);
      expect(ctx.doc.name).toBe('Meal planning 2027');
      expect(ctx.doc.dirty).toBe(true);
      await name.setValue('');
      vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS);
      expect(ctx.doc.name).toBe('Meal planning 2027');
      await name.trigger('keydown', { key: 'Escape' });
      expect(ctx.doc.name).toBe('Example: meal-planning app');
      expect((name.element as HTMLInputElement).value).toBe('Example: meal-planning app');
    });
  });

  describe('canvas rename field', () => {
    const mountEditor = () =>
      mount(NodeTitleEditor, { props: { type: 'opportunity', label: 'opportunity', value: 'Old title' }, attachTo: document.body });

    it('reports a valid title while the field stays open, and at once on a flush', async () => {
      const wrapper = mountEditor();
      const input = wrapper.get('[data-cy="ost-rename-input"]');
      await input.setValue('N');
      vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS);
      expect(wrapper.emitted('draft')).toBeUndefined();
      await input.setValue('New title');
      vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS);
      expect(wrapper.emitted('draft')).toEqual([['New title']]);
      expect(wrapper.emitted('commit')).toBeUndefined();
      await input.setValue('New title, longer');
      flushPendingEdits();
      expect(wrapper.emitted('draft')?.[1]).toEqual(['New title, longer']);
    });

    it('Escape takes the reported drafts back before cancelling', async () => {
      const wrapper = mountEditor();
      const input = wrapper.get('[data-cy="ost-rename-input"]');
      await input.setValue('Typed then regretted');
      vi.advanceTimersByTime(LIVE_COMMIT_DELAY_MS);
      await input.trigger('keydown', { key: 'Escape' });
      expect(wrapper.emitted('draft')).toEqual([['Typed then regretted'], ['Old title']]);
      expect(wrapper.emitted('cancel')).toHaveLength(1);
    });
  });
});
