import { afterEach, describe, expect, it, vi } from 'vitest';

import { enableAutoUnmount, flushPromises } from '@vue/test-utils';

import { dto } from '../../domain/fixtures.test-util';
import { priorityColor } from '../../domain/rules';
import { RuleError } from '../../ost-errors';
import DetailPanel from '../DetailPanel.vue';
import { mountWith, setupStores } from '../panel.test-util';

import DetailTab from './DetailTab.vue';

enableAutoUnmount(afterEach);

async function mountTab(nodeKey: string) {
  const ctx = await setupStores();
  ctx.ui.select(nodeKey);
  const wrapper = await mountWith(DetailTab, ctx.pinia, { nodeKey });
  return { ...ctx, wrapper };
}

/** The tab inside the panel, which owns the inline error slot. */
async function mountInPanel(nodeKey: string) {
  const ctx = await setupStores();
  ctx.ui.select(nodeKey);
  const wrapper = await mountWith(DetailPanel, ctx.pinia);
  return { ...ctx, wrapper };
}

const statusChips = (wrapper: Awaited<ReturnType<typeof mountTab>>['wrapper']) =>
  wrapper.findAll('[data-cy^="ost-status-"]').map(c => c.attributes('data-cy')!.replace('ost-status-', ''));

/** Gives the slider track a 100px-wide box at x=0 (happy-dom has no layout). */
function sizeTrack(el: Element) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 100, height: 26, right: 100, bottom: 26, x: 0, y: 0, toJSON: () => ({}) }),
  });
}

describe('DetailTab', () => {
  it('renders nothing for a node that is not in the tree', async () => {
    const ctx = await setupStores();
    const wrapper = await mountWith(DetailTab, ctx.pinia, { nodeKey: 'solution-99' });
    expect(wrapper.find('[data-cy="ostTab-detail"]').exists()).toBe(false);
  });

  describe('status chips', () => {
    it.each([
      ['opportunity-1', ['unexplored', 'exploring', 'validated', 'parked']],
      ['solution-1', ['candidate', 'exploring', 'devready', 'building', 'shipped', 'dropped']],
      ['assumption-1', ['untested', 'testing', 'supported', 'refuted']],
      ['outcome-1', []],
      ['product-1', []],
      ['evidence-1', []],
    ])('%s → %j', async (key, chips) => {
      const { wrapper } = await mountTab(key);
      expect(statusChips(wrapper)).toEqual(chips);
    });

    it('marks the current status and patches a new one', async () => {
      const { wrapper, service, tree } = await mountTab('opportunity-1');
      expect(wrapper.get('[data-cy="ost-status-exploring"]').attributes('aria-pressed')).toBe('true');
      expect(wrapper.get('[data-cy="ost-status-validated"]').attributes('aria-pressed')).toBe('false');
      service.patchNode.resolves(dto('opportunity-1', 'outcome-1', { status: 'VALIDATED', priority: 50, valueRating: 3 }));
      await wrapper.get('[data-cy="ost-status-validated"]').trigger('click');
      expect(tree.byId('opportunity-1')?.status).toBe('validated'); // shown at once
      await flushPromises();
      expect(service.patchNode.calledOnceWithExactly('opportunity', 1, { status: 'VALIDATED' })).toBe(true);
      expect(wrapper.get('[data-cy="ost-status-validated"]').classes()).toContain('is-on');
      expect(wrapper.get('[data-cy="ost-status-exploring"]').classes()).not.toContain('is-on');
    });

    it('a click on the current status sends nothing', async () => {
      const { wrapper, service } = await mountTab('opportunity-1');
      await wrapper.get('[data-cy="ost-status-exploring"]').trigger('click');
      await flushPromises();
      expect(service.patchNode.called).toBe(false);
    });

    it('a refused status rolls back and is explained in the panel', async () => {
      const { wrapper, service, tree } = await mountInPanel('solution-1');
      service.patchNode.rejects(new RuleError('invalidstatus'));
      await wrapper.get('[data-cy="ost-status-shipped"]').trigger('click');
      await flushPromises();
      expect(tree.byId('solution-1')?.status).toBe('candidate');
      expect(wrapper.get('[data-cy="ost-status-candidate"]').attributes('aria-pressed')).toBe('true');
      expect(wrapper.get('[data-cy="ost-status-shipped"]').attributes('aria-pressed')).toBe('false');
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('That status is not valid for this node.');
      expect(tree.error).toBeNull();
    });
  });

  describe('per-type fields', () => {
    it('confidence and owner only on assumptions; evidence bar only on solutions; value + priority only on opportunities', async () => {
      const present = async (key: string) => {
        const { wrapper } = await mountTab(key);
        return ['ost-confidence', 'ost-owner', 'ost-evidence-bar', 'ost-value-1', 'ost-priority'].filter(cy =>
          wrapper.find(`[data-cy="${cy}"]`).exists(),
        );
      };
      expect(await present('assumption-1')).toEqual(['ost-confidence', 'ost-owner']);
      expect(await present('solution-1')).toEqual(['ost-evidence-bar']);
      expect(await present('opportunity-1')).toEqual(['ost-value-1', 'ost-priority']);
      expect(await present('product-1')).toEqual([]);
      expect(await present('outcome-1')).toEqual([]);
      expect(await present('evidence-1')).toEqual([]);
    });

    it('the typed-fields block is absent for types without any', async () => {
      const opp = await mountTab('opportunity-1');
      expect(opp.wrapper.find('[data-cy="ost-node-fields"]').exists()).toBe(true);
      opp.wrapper.unmount();
      const outcome = await mountTab('outcome-1');
      expect(outcome.wrapper.find('[data-cy="ost-node-fields"]').exists()).toBe(false);
    });

    it('every type has notes and a child list', async () => {
      const { wrapper } = await mountTab('evidence-1');
      expect(wrapper.find('[data-cy="ost-notes"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('Children (0)');
    });
  });

  describe('confidence', () => {
    it('fills the steps up to the value, labels it and patches a step', async () => {
      const { wrapper, service, tree } = await mountTab('assumption-2');
      const on = wrapper.findAll('[data-cy^="ost-confidence-"]').filter(s => s.classes('is-on'));
      expect(on.map(s => s.attributes('data-cy'))).toEqual(['ost-confidence-20', 'ost-confidence-40', 'ost-confidence-60']);
      expect(wrapper.get('[data-cy="ost-confidence-label"]').text()).toBe('Med-high');
      service.patchNode.resolves(dto('assumption-2', 'solution-1', { status: 'TESTING', confidence: 80 }));
      await wrapper.get('[data-cy="ost-confidence-80"]').trigger('click');
      expect(wrapper.get('[data-cy="ost-confidence-label"]').text()).toBe('High confidence'); // shown at once
      await flushPromises();
      expect(service.patchNode.calledOnceWithExactly('assumption', 2, { confidence: 80 })).toBe(true);
      expect(tree.byId('assumption-2')?.conf).toBe(80);
    });

    it('a click on the current step sends nothing', async () => {
      const { wrapper, service } = await mountTab('assumption-2');
      await wrapper.get('[data-cy="ost-confidence-60"]').trigger('click');
      await flushPromises();
      expect(service.patchNode.called).toBe(false);
    });

    it('a refused confidence rolls back and is explained in the panel', async () => {
      const { wrapper, service, tree } = await mountInPanel('assumption-2');
      service.patchNode.rejects(new RuleError('invalidconfidence'));
      await wrapper.get('[data-cy="ost-confidence-100"]').trigger('click');
      await flushPromises();
      expect(tree.byId('assumption-2')?.conf).toBe(60);
      expect(wrapper.get('[data-cy="ost-confidence-label"]').text()).toBe('Med-high');
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('Confidence must be between 0 and 100.');
    });

    it('announces the highest step not above a value that is not a multiple of 20 as pressed', async () => {
      const { wrapper, tree } = await mountTab('assumption-2');
      const pressed = () =>
        wrapper
          .findAll('[data-cy^="ost-confidence-"]')
          .filter(s => s.attributes('aria-pressed') === 'true')
          .map(s => s.attributes('data-cy'));
      expect(pressed()).toEqual(['ost-confidence-60']);
      tree.byId('assumption-2')!.conf = 50;
      await flushPromises();
      expect(pressed()).toEqual(['ost-confidence-40']);
      tree.byId('assumption-2')!.conf = 10;
      await flushPromises();
      expect(pressed()).toEqual([]);
    });

    it('only the step equal to the value is pressed; the steps up to it look filled', async () => {
      const { wrapper } = await mountTab('assumption-2');
      const pressed = [20, 40, 60, 80, 100].map(v => wrapper.get(`[data-cy="ost-confidence-${v}"]`).attributes('aria-pressed'));
      expect(pressed).toEqual(['false', 'false', 'true', 'false', 'false']);
      expect(wrapper.get('[data-cy="ost-confidence-40"]').classes()).toContain('is-on');
    });
  });

  describe('evidence strength', () => {
    it('is derived from the assumptions below: supported → 100, refuted → 0, else confidence', async () => {
      const { wrapper, tree } = await mountTab('solution-1');
      // assumption-1 supported (100), assumption-2 testing at 60 → 80
      expect(wrapper.get('[data-cy="ost-evidence-bar"]').attributes('data-score')).toBe('80');
      expect(wrapper.get('[data-cy="ost-evidence-score"]').text()).toBe('80%');
      expect(wrapper.get('[data-cy="ost-evidence-note"]').text()).toContain('2 assumption tests · 1 supported · 0 refuted');
      tree.byId('assumption-2')!.status = 'refuted';
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-evidence-score"]').text()).toBe('50%');
      // derived, never set by hand: nothing to click
      expect(wrapper.get('[data-cy="ost-evidence-bar"]').findAll('button, input')).toHaveLength(0);
    });

    it('says untested when the solution has no assumptions', async () => {
      const { wrapper } = await mountTab('solution-2');
      expect(wrapper.get('[data-cy="ost-evidence-score"]').text()).toBe('untested');
      expect(wrapper.get('[data-cy="ost-evidence-note"]').text()).toContain('No assumption tests under this solution yet');
    });

    it('the meter says "untested" instead of 0%', async () => {
      const lonely = await mountTab('solution-2');
      const bar = lonely.wrapper.get('[data-cy="ost-evidence-bar"]');
      expect(bar.attributes('aria-valuetext')).toMatch(/^Untested/);
      const tested = await mountTab('solution-1');
      const score = tested.wrapper.get('[data-cy="ost-evidence-bar"]').attributes('data-score');
      expect(tested.wrapper.get('[data-cy="ost-evidence-bar"]').attributes('aria-valuetext')).toBe(`${score}%`);
    });
  });

  describe('value $ scale', () => {
    it('shows five $ steps with the word label and commits on click', async () => {
      const { wrapper, service } = await mountTab('opportunity-1');
      expect(wrapper.findAll('[data-cy^="ost-value-"]').filter(b => /^\$+$/.test(b.text()))).toHaveLength(5);
      expect(wrapper.get('[data-cy="ost-value-5"]').text()).toBe('$$$$$');
      expect(wrapper.get('[data-cy="ost-value-label"]').text()).toBe('Solid');
      expect(wrapper.findAll('.ost-value__step.is-on')).toHaveLength(3);
      service.patchNode.resolves(dto('opportunity-1', 'outcome-1', { status: 'EXPLORING', priority: 50, valueRating: 5 }));
      await wrapper.get('[data-cy="ost-value-5"]').trigger('click');
      expect(wrapper.get('[data-cy="ost-value-label"]').text()).toBe('Outsized');
      await flushPromises();
      expect(service.patchNode.calledOnceWithExactly('opportunity', 1, { valueRating: 5 })).toBe(true);
    });

    it('a click on the current value sends nothing', async () => {
      const { wrapper, service } = await mountTab('opportunity-1');
      await wrapper.get('[data-cy="ost-value-3"]').trigger('click');
      await flushPromises();
      expect(service.patchNode.called).toBe(false);
    });

    it('a refused value rolls back and is explained in the panel', async () => {
      const { wrapper, service, tree } = await mountInPanel('opportunity-1');
      service.patchNode.rejects(new RuleError('invalidvaluerating'));
      await wrapper.get('[data-cy="ost-value-1"]').trigger('click');
      await flushPromises();
      expect(tree.byId('opportunity-1')?.value).toBe(3);
      expect(wrapper.get('[data-cy="ost-value-label"]').text()).toBe('Solid');
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('Value must be between 1 and 5.');
    });

    it('shows an unset value as “—”, not as a value nobody chose', async () => {
      // A node can arrive with no valueRating; the label must not substitute 3 and read "Solid"
      // over zero filled $ glyphs.
      const ctx = await setupStores([
        dto('product-1', null),
        dto('outcome-1', 'product-1'),
        dto('opportunity-1', 'outcome-1', { status: 'EXPLORING', priority: 50, valueRating: null }),
      ]);
      ctx.ui.select('opportunity-1');
      const wrapper = await mountWith(DetailTab, ctx.pinia, { nodeKey: 'opportunity-1' });
      expect(wrapper.get('[data-cy="ost-value-label"]').text()).toBe('—');
      expect(wrapper.findAll('.ost-value__step.is-on')).toHaveLength(0);
    });
  });

  describe('priority slider', () => {
    it('drags a local draft and commits once, on release', async () => {
      const { wrapper, service, tree } = await mountTab('opportunity-1');
      service.patchNode.resolves(dto('opportunity-1', 'outcome-1', { status: 'EXPLORING', priority: 70, valueRating: 3 }));
      const slider = wrapper.get('[data-cy="ost-priority"]');
      sizeTrack(slider.element);
      await slider.trigger('pointerdown', { clientX: 30, button: 0, pointerId: 1 });
      expect(slider.attributes('aria-valuenow')).toBe('30');
      await slider.trigger('pointermove', { clientX: 70, pointerId: 1 });
      expect(slider.attributes('aria-valuenow')).toBe('70');
      expect(wrapper.get('[data-cy="ost-priority-label"]').text()).toBe('High · 70');
      expect(service.patchNode.called).toBe(false);
      expect(tree.byId('opportunity-1')?.priority).toBe(50);
      await slider.trigger('pointerup', { clientX: 70, pointerId: 1 });
      await flushPromises();
      expect(service.patchNode.calledOnceWithExactly('opportunity', 1, { priority: 70 })).toBe(true);
      expect(tree.byId('opportunity-1')?.priority).toBe(70);
    });

    it('clamps to 1–100 and colours the handle on the cold → warm ramp', async () => {
      const { wrapper, service } = await mountTab('opportunity-1');
      service.patchNode.resolves(dto('opportunity-1', 'outcome-1', { status: 'EXPLORING', priority: 1, valueRating: 3 }));
      const slider = wrapper.get('[data-cy="ost-priority"]');
      expect(wrapper.get('[data-cy="ost-priority-handle"]').attributes('data-color')).toBe(priorityColor(50));
      sizeTrack(slider.element);
      await slider.trigger('pointerdown', { clientX: -40, button: 0, pointerId: 1 });
      expect(slider.attributes('aria-valuenow')).toBe('1');
      expect(wrapper.get('[data-cy="ost-priority-handle"]').attributes('data-color')).toBe(priorityColor(1));
      await slider.trigger('pointermove', { clientX: 400, pointerId: 1 });
      expect(slider.attributes('aria-valuenow')).toBe('100');
      await slider.trigger('pointercancel', { pointerId: 1 });
      expect(slider.attributes('aria-valuenow')).toBe('50');
      expect(service.patchNode.called).toBe(false);
    });

    it('key presses move the value at once but commit one change once the keys are idle', async () => {
      const { wrapper, service } = await mountTab('opportunity-1');
      service.patchNode.resolves(dto('opportunity-1', 'outcome-1', { status: 'EXPLORING', priority: 63, valueRating: 3 }));
      vi.useFakeTimers();
      try {
        const slider = wrapper.get('[data-cy="ost-priority"]');
        await slider.trigger('keydown', { key: 'PageUp' });
        for (let i = 0; i < 3; i++) await slider.trigger('keydown', { key: 'ArrowRight', repeat: true });
        expect(slider.attributes('aria-valuenow')).toBe('63');
        vi.advanceTimersByTime(300);
        expect(service.patchNode.called).toBe(false);
        vi.advanceTimersByTime(200);
      } finally {
        vi.useRealTimers();
      }
      await flushPromises();
      expect(service.patchNode.calledOnceWithExactly('opportunity', 1, { priority: 63 })).toBe(true);
    });

    it('blur commits a pending keyboard value immediately; back to the start sends nothing', async () => {
      const { wrapper, service } = await mountTab('opportunity-1');
      service.patchNode.resolves(dto('opportunity-1', 'outcome-1', { status: 'EXPLORING', priority: 100, valueRating: 3 }));
      const slider = wrapper.get('[data-cy="ost-priority"]');
      await slider.trigger('keydown', { key: 'ArrowUp' });
      await slider.trigger('keydown', { key: 'ArrowDown' });
      await slider.trigger('blur');
      await flushPromises();
      expect(service.patchNode.called).toBe(false);
      await slider.trigger('keydown', { key: 'End' });
      await slider.trigger('blur');
      await flushPromises();
      expect(service.patchNode.calledOnceWithExactly('opportunity', 1, { priority: 100 })).toBe(true);
    });

    it('a refused priority rolls back and is explained in the panel', async () => {
      const { wrapper, service, tree } = await mountInPanel('opportunity-1');
      service.patchNode.rejects(new RuleError('invalidpriority'));
      const slider = wrapper.get('[data-cy="ost-priority"]');
      await slider.trigger('keydown', { key: 'Home' });
      await slider.trigger('blur');
      await flushPromises();
      expect(service.patchNode.calledOnceWithExactly('opportunity', 1, { priority: 1 })).toBe(true);
      expect(tree.byId('opportunity-1')?.priority).toBe(50);
      expect(slider.attributes('aria-valuenow')).toBe('50');
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('Priority must be between 1 and 100.');
    });
  });

  describe('owner', () => {
    const owner = (wrapper: Awaited<ReturnType<typeof mountTab>>['wrapper']) => wrapper.get('[data-cy="ost-owner"]');

    it('is a free-text field showing the stored owner', async () => {
      const { wrapper } = await mountTab('assumption-1');
      expect(owner(wrapper).element.tagName).toBe('INPUT');
      expect((owner(wrapper).element as HTMLInputElement).value).toBe('Kira P');
      const empty = await mountTab('assumption-2');
      expect((owner(empty.wrapper).element as HTMLInputElement).value).toBe('');
    });

    it('patches the trimmed text on Enter', async () => {
      const { wrapper, service, tree } = await mountTab('assumption-2');
      service.patchNode.resolves(dto('assumption-2', 'solution-1', { status: 'TESTING', confidence: 60, owner: 'Ana R' }));
      const input = owner(wrapper);
      (input.element as HTMLInputElement).focus();
      await input.setValue('  Ana R ');
      expect(service.patchNode.called).toBe(false);
      await input.trigger('keydown', { key: 'Enter' });
      await flushPromises();
      expect(service.patchNode.calledOnceWithExactly('assumption', 2, { owner: 'Ana R' })).toBe(true);
      expect(tree.byId('assumption-2')?.owner).toBe('Ana R');
      expect((input.element as HTMLInputElement).value).toBe('Ana R');
    });

    it('patches on blur; clearing the field removes the owner', async () => {
      const { wrapper, service, tree } = await mountTab('assumption-1');
      service.patchNode.resolves(dto('assumption-1', 'solution-1', { status: 'SUPPORTED', confidence: 30, owner: null }));
      const input = owner(wrapper);
      await input.trigger('focus');
      await input.setValue('');
      await input.trigger('blur');
      await flushPromises();
      expect(service.patchNode.calledOnceWithExactly('assumption', 1, { owner: null })).toBe(true);
      expect(tree.byId('assumption-1')?.owner).toBe('');
    });

    it('shows the owner as stored when the document cleans it up', async () => {
      const { wrapper, service } = await mountTab('assumption-2');
      service.patchNode.resolves(dto('assumption-2', 'solution-1', { status: 'TESTING', confidence: 60, owner: 'Research group' }));
      const input = owner(wrapper);
      await input.trigger('focus');
      await input.setValue('Research   group');
      await input.trigger('blur');
      await flushPromises();
      expect((input.element as HTMLInputElement).value).toBe('Research group');
    });

    it('sends nothing when the owner is unchanged or the edit is cancelled with Escape', async () => {
      const { wrapper, service } = await mountTab('assumption-1');
      const input = owner(wrapper);
      await input.trigger('focus');
      await input.setValue(' Kira P ');
      await input.trigger('blur');
      await input.trigger('focus');
      await input.setValue('Someone else');
      await input.trigger('keydown', { key: 'Escape' });
      expect((input.element as HTMLInputElement).value).toBe('Kira P');
      await input.trigger('blur');
      await flushPromises();
      expect(service.patchNode.called).toBe(false);
    });

    it('a refused owner rolls back', async () => {
      const { wrapper, service, tree } = await mountTab('assumption-2');
      service.patchNode.rejects(new RuleError('invalidowner'));
      const input = owner(wrapper);
      await input.trigger('focus');
      await input.setValue('Ana R');
      await input.trigger('blur');
      await flushPromises();
      expect(service.patchNode.calledOnceWithExactly('assumption', 2, { owner: 'Ana R' })).toBe(true);
      expect(tree.byId('assumption-2')?.owner).toBe('');
      expect((input.element as HTMLInputElement).value).toBe('');
      // DetailTab alone has no panel to show it in — the message is still taken off the toast
      expect(tree.error).toBeNull();
    });

    it('a refused owner is explained in the panel', async () => {
      const { wrapper, service } = await mountInPanel('assumption-2');
      service.patchNode.rejects(new RuleError('invalidowner'));
      const input = owner(wrapper);
      await input.trigger('focus');
      await input.setValue('Ana R');
      await input.trigger('blur');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('Owner names can be at most 100 characters.');
    });
  });

  describe('notes', () => {
    it('shows the stored notes', async () => {
      const ctx = await setupStores([dto('product-1', null, { notes: 'What we know so far' })]);
      const wrapper = await mountWith(DetailTab, ctx.pinia, { nodeKey: 'product-1' });
      expect((wrapper.get('[data-cy="ost-notes"]').element as HTMLTextAreaElement).value).toBe('What we know so far');
    });

    it('commits on blur only', async () => {
      const { wrapper, service } = await mountTab('outcome-1');
      service.patchNode.resolves(dto('outcome-1', 'product-1', { notes: 'Learned a lot' }));
      const notes = wrapper.get('[data-cy="ost-notes"]');
      await notes.trigger('focus');
      await notes.setValue('Learned a lot');
      expect(service.patchNode.called).toBe(false);
      await notes.trigger('blur');
      await flushPromises();
      expect(service.patchNode.calledOnceWithExactly('outcome', 1, { notes: 'Learned a lot' })).toBe(true);
    });

    it('leaving the field without a change sends nothing', async () => {
      const { wrapper, service } = await mountTab('outcome-1');
      const notes = wrapper.get('[data-cy="ost-notes"]');
      await notes.trigger('focus');
      await notes.trigger('blur');
      await flushPromises();
      expect(service.patchNode.called).toBe(false);
    });

    it('emptied notes are stored as none', async () => {
      const ctx = await setupStores([dto('product-1', null, { notes: 'Old notes' })]);
      ctx.service.patchNode.resolves(dto('product-1', null, { notes: null }));
      const wrapper = await mountWith(DetailTab, ctx.pinia, { nodeKey: 'product-1' });
      const notes = wrapper.get('[data-cy="ost-notes"]');
      await notes.trigger('focus');
      await notes.setValue('');
      await notes.trigger('blur');
      await flushPromises();
      expect(ctx.service.patchNode.calledOnceWithExactly('product', 1, { notes: null })).toBe(true);
      expect(ctx.tree.byId('product-1')?.note).toBe('');
    });

    it('a failed save keeps the typed notes in the field (rolled back in the tree only)', async () => {
      const { wrapper, service, tree } = await mountTab('solution-1');
      service.patchNode.rejects(new Error('boom'));
      const notes = wrapper.get('[data-cy="ost-notes"]');
      await notes.trigger('focus');
      await notes.setValue('Typed notes worth keeping');
      await notes.trigger('blur');
      await flushPromises();
      expect(service.patchNode.calledOnceWithExactly('solution', 1, { notes: 'Typed notes worth keeping' })).toBe(true);
      expect(tree.byId('solution-1')?.note).toBe('');
      expect((notes.element as HTMLTextAreaElement).value).toBe('Typed notes worth keeping');
      // Blurring again retries with the kept text.
      service.patchNode.resolves(dto('solution-1', 'opportunity-1', { notes: 'Typed notes worth keeping' }));
      await notes.trigger('focus');
      await notes.trigger('blur');
      await flushPromises();
      expect(service.patchNode.callCount).toBe(2);
      expect(tree.byId('solution-1')?.note).toBe('Typed notes worth keeping');
      expect((notes.element as HTMLTextAreaElement).value).toBe('Typed notes worth keeping');
    });

    it('a failed save is explained in the panel', async () => {
      const { wrapper, service } = await mountInPanel('solution-1');
      service.patchNode.rejects(new RuleError('invalidnotes'));
      const notes = wrapper.get('[data-cy="ost-notes"]');
      await notes.trigger('focus');
      await notes.setValue('Typed notes worth keeping');
      await notes.trigger('blur');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('Notes can be at most 20,000 characters.');
      expect((notes.element as HTMLTextAreaElement).value).toBe('Typed notes worth keeping');
    });

    it('a successful save follows the stored copy', async () => {
      const { wrapper, service, tree } = await mountTab('solution-1');
      service.patchNode.resolves(dto('solution-1', 'opportunity-1', { notes: 'Saved' }));
      const notes = wrapper.get('[data-cy="ost-notes"]');
      await notes.trigger('focus');
      await notes.setValue('Saved');
      await notes.trigger('blur');
      await flushPromises();
      expect(tree.byId('solution-1')?.note).toBe('Saved');
      tree.byId('solution-1')!.note = 'Changed elsewhere';
      await flushPromises();
      expect((notes.element as HTMLTextAreaElement).value).toBe('Changed elsewhere');
    });
  });

  describe('children and quick-add', () => {
    it('lists the children; a click selects and centres the child', async () => {
      const { wrapper, ui } = await mountTab('opportunity-1');
      expect(wrapper.text()).toContain('Children (2)');
      expect(wrapper.findAll('[data-cy^="ost-child-"]').map(c => c.attributes('data-cy'))).toEqual([
        'ost-child-solution-1',
        'ost-child-solution-2',
      ]);
      expect(wrapper.get('[data-cy="ost-child-solution-1"]').text()).toContain('Solution');
      expect(wrapper.get('[data-cy="ost-child-solution-1"]').text()).toContain('In-app invite');
      await wrapper.get('[data-cy="ost-child-solution-2"]').trigger('click');
      expect(ui.selectedId).toBe('solution-2');
      expect(ui.centreRequest?.key).toBe('solution-2');
    });

    it.each([
      ['product-1', ['outcome']],
      ['outcome-1', ['opportunity']],
      ['opportunity-1', ['opportunity', 'solution', 'evidence']],
      ['solution-1', ['assumption']],
      ['assumption-1', ['evidence']],
      ['evidence-1', []],
    ])('%s quick-adds %j', async (key, types) => {
      const { wrapper } = await mountTab(key);
      expect(wrapper.findAll('[data-cy^="ost-quick-add-"]').map(b => b.attributes('data-cy')!.replace('ost-quick-add-', ''))).toEqual(
        types,
      );
    });

    it('creates the child, selects it, puts it in rename mode and centres it', async () => {
      const { wrapper, service, ui, tree } = await mountTab('solution-2');
      service.createNode.resolves(dto('assumption-9', 'solution-2', { title: 'New assumption', status: 'UNTESTED', confidence: 40 }));
      expect(wrapper.get('[data-cy="ost-quick-add-assumption"]').text()).toBe('+ Assumption');
      await wrapper.get('[data-cy="ost-quick-add-assumption"]').trigger('click');
      await flushPromises();
      expect(service.createNode.calledOnceWithExactly({ type: 'ASSUMPTION', parentType: 'SOLUTION', parentId: 2 })).toBe(true);
      expect(tree.byId('assumption-9')).toBeDefined();
      expect(ui.selectedId).toBe('assumption-9');
      expect(ui.editingId).toBe('assumption-9');
      expect(ui.centreRequest?.key).toBe('assumption-9');
      // the tab still shows its own node, now with the new child
      expect(wrapper.text()).toContain('Children (1)');
      expect(wrapper.find('[data-cy="ost-child-assumption-9"]').exists()).toBe(true);
    });

    it('creates one node at a time: the buttons are disabled while a create is running', async () => {
      const { wrapper, service } = await mountTab('opportunity-1');
      let resolve!: (node: ReturnType<typeof dto>) => void;
      service.createNode.returns(new Promise(r => (resolve = r)));
      await wrapper.get('[data-cy="ost-quick-add-solution"]').trigger('click');
      const buttons = () => wrapper.findAll('[data-cy^="ost-quick-add-"]').map(b => b.attributes('disabled') !== undefined);
      expect(buttons()).toEqual([true, true, true]);
      await wrapper.get('[data-cy="ost-quick-add-evidence"]').trigger('click');
      expect(service.createNode.callCount).toBe(1);
      resolve(dto('solution-9', 'opportunity-1', { title: 'New solution', status: 'CANDIDATE' }));
      await flushPromises();
      expect(buttons()).toEqual([false, false, false]);
    });

    it('a failed create changes nothing and frees the buttons', async () => {
      const { wrapper, service, ui, tree } = await mountTab('solution-2');
      service.createNode.rejects(new Error('boom'));
      await wrapper.get('[data-cy="ost-quick-add-assumption"]').trigger('click');
      await flushPromises();
      expect(ui.selectedId).toBe('solution-2');
      expect(ui.centreRequest).toBeNull();
      expect(wrapper.text()).toContain('Children (0)');
      expect(wrapper.get('[data-cy="ost-quick-add-assumption"]').attributes('disabled')).toBeUndefined();
      expect(tree.error).toBeNull(); // taken off the toast (shown in the panel, when there is one)
    });

    it('a failed create is explained in the panel', async () => {
      const { wrapper, service } = await mountInPanel('solution-2');
      service.createNode.rejects(new RuleError('parentmissing'));
      await wrapper.get('[data-cy="ost-quick-add-assumption"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('The parent node no longer exists.');
      service.createNode.rejects(new Error('boom'));
      await wrapper.get('[data-cy="ost-quick-add-assumption"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('The node could not be created.');
    });
  });

  describe('layout', () => {
    it('labels use the spacing of their field', async () => {
      const { wrapper } = await mountTab('opportunity-1');
      const label = (text: string) => wrapper.findAll('.ost-field__label').find(l => l.text().startsWith(text))!;
      expect(label('Status').classes()).toContain('ost-field__label--6');
      expect(label('Opportunity value').classes()).toContain('ost-field__label--7');
      expect(label('Priority').classes()).toContain('ost-field__label--8');
      expect(label('Notes').classes()).toContain('ost-field__label--6');
      expect(label('Children').classes()).toContain('ost-field__label--7');
    });

    it('the assumption labels too', async () => {
      const { wrapper } = await mountTab('assumption-1');
      const label = (text: string) => wrapper.findAll('.ost-field__label').find(l => l.text().startsWith(text))!;
      expect(label('Confidence').classes()).toContain('ost-field__label--6');
      expect(label('Owner').classes()).toContain('ost-field__label--6');
    });
  });
});
