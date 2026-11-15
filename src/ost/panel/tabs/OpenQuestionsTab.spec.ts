import { afterEach, describe, expect, it } from 'vitest';

import { enableAutoUnmount, flushPromises } from '@vue/test-utils';

import { dto } from '../../domain/fixtures.test-util';
import { RuleError } from '../../ost-errors';
import DetailPanel from '../DetailPanel.vue';
import { mountWith, setupStores } from '../panel.test-util';

import OpenQuestionsTab from './OpenQuestionsTab.vue';

enableAutoUnmount(afterEach);

async function mountTab() {
  const ctx = await setupStores();
  ctx.ui.select('opportunity-1');
  const wrapper = await mountWith(OpenQuestionsTab, ctx.pinia, { nodeKey: 'opportunity-1' });
  return { ...ctx, wrapper };
}

/** The tab inside the panel, which owns the inline error slot and the tab badge. */
async function mountInPanel() {
  const ctx = await setupStores();
  ctx.ui.select('opportunity-1');
  ctx.ui.setPanelTab('questions');
  const wrapper = await mountWith(DetailPanel, ctx.pinia);
  return { ...ctx, wrapper };
}

describe('OpenQuestionsTab', () => {
  it('lists the questions as a checklist with the hint and the summary', async () => {
    const { wrapper } = await mountTab();
    expect(wrapper.get('[data-cy="ost-questions-hint"]').text()).toBe(
      'What do we still need to learn about this opportunity? Tick a question off once it is answered.',
    );
    const toggles = wrapper.findAll('[data-cy^="ost-question-toggle-"]');
    expect(toggles.map(b => b.attributes('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(toggles.map(b => b.attributes('role'))).toEqual(['checkbox', 'checkbox', 'checkbox']);
    expect(toggles.map(b => b.attributes('aria-label'))).toEqual(['Who?', 'When?', 'Why?']);
    expect(wrapper.findAll('.ost-questions__text').map(t => t.text())).toEqual(['Who?', 'When?', 'Why?']);
    expect(wrapper.get('[data-cy="ost-question-2"]').find('.ost-questions__text').classes()).toContain('is-done');
    expect(wrapper.get('[data-cy="ost-question-1"]').find('.ost-questions__text').classes()).not.toContain('is-done');
    expect(wrapper.get('[data-cy="ost-question-2"]').attributes('data-done')).toBe('true');
    expect(wrapper.get('[data-cy="ost-question-remove-3"]').attributes('aria-label')).toBe('Remove question: Why?');
    expect(wrapper.get('[data-cy="ost-questions-summary"]').text()).toBe('2 open · 1 answered');
    expect(wrapper.get('[data-cy="ost-question-add"]').attributes('placeholder')).toBe('Add an open question, then Enter');
    expect(wrapper.get('[data-cy="ost-question-add"]').attributes('maxlength')).toBe('500');
    expect(wrapper.find('[data-cy="ost-questions-empty"]').exists()).toBe(false);
  });

  it('an opportunity without questions says so and still takes a first one', async () => {
    const ctx = await setupStores([dto('project-1', null), dto('outcome-1', 'project-1'), dto('opportunity-1', 'outcome-1')]);
    ctx.service.addQuestion.resolves({ id: 1, text: 'Who is this for?', done: false });
    const wrapper = await mountWith(OpenQuestionsTab, ctx.pinia, { nodeKey: 'opportunity-1' });
    expect(wrapper.get('[data-cy="ost-questions-empty"]').text()).toBe('No open questions yet.');
    expect(wrapper.find('[data-cy^="ost-question-toggle-"]').exists()).toBe(false);
    expect(wrapper.get('[data-cy="ost-questions-summary"]').text()).toBe('0 open · 0 answered');
    const add = wrapper.get('[data-cy="ost-question-add"]');
    await add.setValue('Who is this for?');
    await add.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(wrapper.find('[data-cy="ost-questions-empty"]').exists()).toBe(false);
    expect(wrapper.get('[data-cy="ost-questions-summary"]').text()).toBe('1 open · 0 answered');
  });

  it.each(['outcome-1', 'solution-1', 'solution-99'])('renders nothing for %s: only opportunities have open questions', async key => {
    const ctx = await setupStores();
    const wrapper = await mountWith(OpenQuestionsTab, ctx.pinia, { nodeKey: key });
    expect(wrapper.find('[data-cy="ostTab-questions"]').exists()).toBe(false);
    expect(wrapper.find('[data-cy="ost-question-add"]').exists()).toBe(false);
  });

  describe('add', () => {
    it('Enter adds a trimmed question and clears the input; blank input adds nothing', async () => {
      const { wrapper, service, tree } = await mountTab();
      service.addQuestion.resolves({ id: 4, text: 'How often?', done: false });
      const add = wrapper.get('[data-cy="ost-question-add"]');
      await add.setValue('   ');
      await add.trigger('keydown', { key: 'Enter' });
      await flushPromises();
      expect(service.addQuestion.called).toBe(false);
      await add.setValue('  How often? ');
      await add.trigger('keydown', { key: 'Enter' });
      await flushPromises();
      expect(service.addQuestion.calledOnceWithExactly(1, 'How often?')).toBe(true);
      expect((add.element as HTMLInputElement).value).toBe('');
      expect(wrapper.get('[data-cy="ost-question-4"]').text()).toContain('How often?');
      expect(wrapper.get('[data-cy="ost-question-toggle-4"]').attributes('aria-checked')).toBe('false');
      expect(wrapper.get('[data-cy="ost-questions-summary"]').text()).toBe('3 open · 1 answered');
      expect(tree.byId('opportunity-1')?.questions.map(q => q.id)).toEqual([1, 2, 3, 4]);
    });

    it('adds one at a time and hands focus back so questions can follow one another', async () => {
      const { wrapper, service } = await mountTab();
      let resolve!: (q: { id: number; text: string; done: boolean }) => void;
      service.addQuestion.returns(new Promise(r => (resolve = r)));
      const add = wrapper.get('[data-cy="ost-question-add"]');
      (add.element as HTMLInputElement).focus();
      await add.setValue('How often?');
      await add.trigger('keydown', { key: 'Enter' });
      expect(add.attributes('disabled')).toBeDefined();
      await add.trigger('keydown', { key: 'Enter' });
      expect(service.addQuestion.callCount).toBe(1);
      resolve({ id: 4, text: 'How often?', done: false });
      await flushPromises();
      expect(add.attributes('disabled')).toBeUndefined();
      expect(document.activeElement).toBe(add.element);
      expect(wrapper.findAll('[data-cy^="ost-question-toggle-"]')).toHaveLength(4);
    });

    it('Escape clears what was typed without adding', async () => {
      const { wrapper, service } = await mountTab();
      const add = wrapper.get('[data-cy="ost-question-add"]');
      await add.setValue('Never mind');
      await add.trigger('keydown', { key: 'Escape' });
      await flushPromises();
      expect((add.element as HTMLInputElement).value).toBe('');
      expect(service.addQuestion.called).toBe(false);
    });

    it('shows a refused add inline in the panel and keeps the text', async () => {
      const { wrapper, service, tree } = await mountInPanel();
      service.addQuestion.rejects(new RuleError('questiontextinvalid'));
      const add = wrapper.get('[data-cy="ost-question-add"]');
      await add.setValue('Too long, say');
      await add.trigger('keydown', { key: 'Enter' });
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('Questions need 1 to 500 characters.');
      expect(tree.error).toBeNull();
      expect((add.element as HTMLInputElement).value).toBe('Too long, say');
      expect(add.attributes('disabled')).toBeUndefined();
      expect(wrapper.findAll('[data-cy^="ost-question-toggle-"]')).toHaveLength(3);
    });

    it('an add that fails for no known rule says the question could not be added', async () => {
      const { wrapper, service } = await mountInPanel();
      service.addQuestion.rejects(new Error('boom'));
      const add = wrapper.get('[data-cy="ost-question-add"]');
      await add.setValue('How often?');
      await add.trigger('keydown', { key: 'Enter' });
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('The question could not be added.');
    });
  });

  describe('tick', () => {
    it('ticks and unticks', async () => {
      const { wrapper, service } = await mountTab();
      service.updateQuestion.onFirstCall().resolves({ id: 1, text: 'Who?', done: true });
      service.updateQuestion.onSecondCall().resolves({ id: 2, text: 'When?', done: false });
      await wrapper.get('[data-cy="ost-question-toggle-1"]').trigger('click');
      expect(wrapper.get('[data-cy="ost-question-toggle-1"]').attributes('aria-checked')).toBe('true'); // shown at once
      await flushPromises();
      expect(service.updateQuestion.firstCall.args).toEqual([1, { done: true }]);
      await wrapper.get('[data-cy="ost-question-toggle-2"]').trigger('click');
      await flushPromises();
      expect(service.updateQuestion.secondCall.args).toEqual([2, { done: false }]);
      expect(wrapper.get('[data-cy="ost-question-toggle-1"]').attributes('aria-checked')).toBe('true');
      expect(wrapper.get('[data-cy="ost-question-toggle-2"]').attributes('aria-checked')).toBe('false');
      expect(wrapper.get('[data-cy="ost-question-1"]').find('.ost-questions__text').classes()).toContain('is-done');
      expect(wrapper.get('[data-cy="ost-questions-summary"]').text()).toBe('2 open · 1 answered');
    });

    it('a refused tick rolls back', async () => {
      const { wrapper, service, tree } = await mountTab();
      service.updateQuestion.rejects(new Error('boom'));
      await wrapper.get('[data-cy="ost-question-toggle-1"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-question-toggle-1"]').attributes('aria-checked')).toBe('false');
      expect(wrapper.get('[data-cy="ost-questions-summary"]').text()).toBe('2 open · 1 answered');
      expect(tree.error).toBeNull(); // taken off the toast (shown in the panel, when there is one)
    });

    it('a refused tick is explained in the panel', async () => {
      const { wrapper, service } = await mountInPanel();
      service.updateQuestion.rejects(new Error('boom'));
      await wrapper.get('[data-cy="ost-question-toggle-1"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('The question could not be saved.');
      service.updateQuestion.rejects(new RuleError('questionmissing'));
      await wrapper.get('[data-cy="ost-question-toggle-1"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('That question no longer exists.');
      expect(wrapper.get('[data-cy="ost-tab-badge-questions"]').text()).toBe('2');
    });
  });

  describe('remove', () => {
    it('removes a question once the document service accepted', async () => {
      const { wrapper, service, tree } = await mountTab();
      let resolve!: () => void;
      service.deleteQuestion.returns(new Promise<void>(r => (resolve = r)));
      await wrapper.get('[data-cy="ost-question-remove-3"]').trigger('click');
      await flushPromises();
      expect(service.deleteQuestion.calledOnceWithExactly(3)).toBe(true);
      expect(wrapper.find('[data-cy="ost-question-3"]').exists()).toBe(true); // not before
      resolve();
      await flushPromises();
      expect(wrapper.find('[data-cy="ost-question-3"]').exists()).toBe(false);
      expect(wrapper.get('[data-cy="ost-questions-summary"]').text()).toBe('1 open · 1 answered');
      expect(tree.byId('opportunity-1')?.questions.map(q => q.id)).toEqual([1, 2]);
    });

    it('removing an answered question lowers the answered count', async () => {
      const { wrapper, service } = await mountTab();
      service.deleteQuestion.resolves();
      await wrapper.get('[data-cy="ost-question-remove-2"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-questions-summary"]').text()).toBe('2 open · 0 answered');
    });

    it('a refused remove keeps the question and is explained in the panel', async () => {
      const { wrapper, service, tree } = await mountInPanel();
      service.deleteQuestion.rejects(new Error('boom'));
      await wrapper.get('[data-cy="ost-question-remove-3"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-cy="ost-question-3"]').exists()).toBe(true);
      expect(tree.byId('opportunity-1')?.questions.map(q => q.id)).toEqual([1, 2, 3]);
      expect(wrapper.get('[data-cy="ost-questions-summary"]').text()).toBe('2 open · 1 answered');
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('The question could not be removed.');
    });
  });

  it('the Open Qs tab badge counts the open questions', async () => {
    const { wrapper, service } = await mountInPanel();
    expect(wrapper.get('[data-cy="ost-tab-badge-questions"]').text()).toBe('2');
    service.updateQuestion.resolves({ id: 1, text: 'Who?', done: true });
    await wrapper.get('[data-cy="ost-question-toggle-1"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-cy="ost-tab-badge-questions"]').text()).toBe('1');
    service.updateQuestion.resolves({ id: 3, text: 'Why?', done: true });
    await wrapper.get('[data-cy="ost-question-toggle-3"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-cy="ost-tab-badge-questions"]').exists()).toBe(false);
    expect(wrapper.get('[data-cy="ost-questions-summary"]').text()).toBe('0 open · 3 answered');
  });
});
