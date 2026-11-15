import { afterEach, describe, expect, it } from 'vitest';

import { enableAutoUnmount, flushPromises } from '@vue/test-utils';

import { dto } from '../domain/fixtures.test-util';
import { RuleError } from '../ost-errors';

import DetailPanel from './DetailPanel.vue';
import { mountWith, setupStores } from './panel.test-util';

enableAutoUnmount(afterEach);

async function mountPanel(select: string | null) {
  const ctx = await setupStores();
  ctx.ui.select(select);
  const wrapper = await mountWith(DetailPanel, ctx.pinia);
  return { ...ctx, wrapper };
}

const tabIds = (wrapper: Awaited<ReturnType<typeof mountPanel>>['wrapper']) =>
  wrapper.findAll('[data-cy^="ost-tab-"]:not([data-cy^="ost-tab-badge"])').map(t => t.attributes('data-cy')!.replace('ost-tab-', ''));

describe('DetailPanel', () => {
  it('renders nothing while no node is selected', async () => {
    const { wrapper } = await mountPanel(null);
    expect(wrapper.find('[data-cy="ost-panel"]').exists()).toBe(false);
    expect(wrapper.find('[data-cy="ost-panel-reopen"]').exists()).toBe(false);
  });

  describe('tab set per type', () => {
    it.each([
      ['project-1', ['detail', 'links']],
      ['outcome-1', ['detail', 'links']],
      ['opportunity-1', ['detail', 'links', 'questions']],
      ['solution-1', ['detail', 'links']],
      ['assumption-1', ['detail', 'links']],
      ['evidence-1', ['detail', 'links']],
    ])('%s → %j', async (key, tabs) => {
      const { wrapper } = await mountPanel(key);
      expect(tabIds(wrapper)).toEqual(tabs);
    });

    it('labels the tabs and badges the links and the open questions (never Detail)', async () => {
      const { wrapper } = await mountPanel('opportunity-1');
      expect(wrapper.get('[data-cy="ost-tab-detail"]').text()).toBe('Detail');
      expect(wrapper.get('[data-cy="ost-tab-links"]').text()).toContain('Links');
      expect(wrapper.get('[data-cy="ost-tab-questions"]').text()).toContain('Open Qs');
      expect(wrapper.get('[data-cy="ost-tab-badge-links"]').text()).toBe('2');
      expect(wrapper.get('[data-cy="ost-tab-badge-questions"]').text()).toBe('2'); // 2 open, 1 answered
      expect(wrapper.find('[data-cy="ost-tab-badge-detail"]').exists()).toBe(false);
    });

    it('hides zero badges', async () => {
      const { wrapper } = await mountPanel('solution-1');
      expect(wrapper.find('[data-cy="ost-tab-badge-links"]').exists()).toBe(false);
    });

    it('the links badge follows the node’s links', async () => {
      const { wrapper, tree } = await mountPanel('solution-1');
      tree.byId('solution-1')!.links.push({ id: 30, name: 'Spec', url: 'https://example.com/spec' });
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-tab-badge-links"]').text()).toBe('1');
    });

    it('shows the Detail tab first and switches to the tab that is clicked', async () => {
      const { wrapper, ui } = await mountPanel('opportunity-1');
      expect(wrapper.get('[data-cy="ost-tab-detail"]').attributes('aria-selected')).toBe('true');
      expect(wrapper.find('[data-cy="ostTab-detail"]').exists()).toBe(true);
      await wrapper.get('[data-cy="ost-tab-links"]').trigger('click');
      expect(ui.panelTab).toBe('links');
      expect(wrapper.get('[data-cy="ost-tab-links"]').classes()).toContain('is-active');
      expect(wrapper.get('[data-cy="ost-tab-detail"]').attributes('aria-selected')).toBe('false');
      expect(wrapper.find('[data-cy="ostTab-links"]').exists()).toBe(true);
      expect(wrapper.find('[data-cy="ostTab-detail"]').exists()).toBe(false);
    });

    it('switches tabs and falls back to Detail when the type has no such tab', async () => {
      const { wrapper, ui } = await mountPanel('opportunity-1');
      await wrapper.get('[data-cy="ost-tab-questions"]').trigger('click');
      expect(ui.panelTab).toBe('questions');
      expect(wrapper.find('[data-cy="ostTab-questions"]').exists()).toBe(true);
      ui.select('project-1');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-tab-detail"]').classes()).toContain('is-active');
      expect(wrapper.find('[data-cy="ostTab-detail"]').exists()).toBe(true);
      // the chosen tab is kept: back on an opportunity it shows again
      ui.select('opportunity-1');
      await flushPromises();
      expect(wrapper.find('[data-cy="ostTab-questions"]').exists()).toBe(true);
    });

    it('keeps the chosen tab from node to node', async () => {
      const { wrapper, ui } = await mountPanel('opportunity-1');
      await wrapper.get('[data-cy="ost-tab-links"]').trigger('click');
      ui.select('project-1');
      await flushPromises();
      expect(wrapper.find('[data-cy="ostTab-links"]').exists()).toBe(true);
      expect(wrapper.find('[data-cy="ost-link-row-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-cy="ost-link-row-11"]').exists()).toBe(false);
    });
  });

  describe('header', () => {
    it.each([
      ['project-1', 'Project'],
      ['outcome-1', 'Outcome'],
      ['opportunity-1', 'Opportunity'],
      ['solution-1', 'Solution'],
      ['assumption-1', 'Assumption'],
      ['evidence-1', 'Evidence'],
    ])('%s: the kicker and the labels say %s', async (key, label) => {
      const { wrapper } = await mountPanel(key);
      expect(wrapper.get('[data-cy="ost-panel-kicker"]').text()).toBe(label);
      expect(wrapper.get('[data-cy="ost-panel"]').attributes('aria-label')).toBe(`${label} details`);
      expect(wrapper.get('[data-cy="ost-panel-title"]').attributes('aria-label')).toBe(`${label} title`);
    });

    it('shows the type kicker, the title and the ancestor breadcrumb', async () => {
      const { wrapper } = await mountPanel('assumption-1');
      expect(wrapper.get('[data-cy="ost-panel-kicker"]').text()).toBe('Assumption');
      expect((wrapper.get('[data-cy="ost-panel-title"]').element as HTMLInputElement).value).toBe('Users accept');
      const crumbs = wrapper.findAll('[data-cy^="ost-breadcrumb-"]').map(c => c.attributes('data-cy'));
      expect(crumbs).toEqual([
        'ost-breadcrumb-project-1',
        'ost-breadcrumb-outcome-1',
        'ost-breadcrumb-opportunity-1',
        'ost-breadcrumb-solution-1',
      ]);
      expect(wrapper.get('[data-cy="ost-breadcrumb"]').text()).toContain('Discovery Hub');
      expect(wrapper.get('[data-cy="ost-breadcrumb-solution-1"]').text()).toBe('In-app invite');
    });

    it('projects are the top of the tree', async () => {
      const { wrapper } = await mountPanel('project-1');
      expect(wrapper.get('[data-cy="ost-breadcrumb"]').text()).toBe('Top of the tree');
    });

    it('a breadcrumb click selects the ancestor and asks the canvas to centre it', async () => {
      const { wrapper, ui } = await mountPanel('assumption-1');
      await wrapper.get('[data-cy="ost-breadcrumb-outcome-1"]').trigger('click');
      expect(ui.selectedId).toBe('outcome-1');
      expect(ui.centreRequest?.key).toBe('outcome-1');
      expect((wrapper.get('[data-cy="ost-panel-title"]').element as HTMLInputElement).value).toBe('Weekly interviews');
      expect(wrapper.findAll('[data-cy^="ost-breadcrumb-"]').map(c => c.attributes('data-cy'))).toEqual(['ost-breadcrumb-project-1']);
    });

    it('commits the title on Enter, which leaves the field', async () => {
      const { wrapper, service, tree } = await mountPanel('outcome-1');
      service.patchNode.resolves(dto('outcome-1', 'project-1', { title: 'Renamed outcome' }));
      const input = wrapper.get('[data-cy="ost-panel-title"]');
      (input.element as HTMLInputElement).focus();
      await input.setValue('Renamed outcome');
      await input.trigger('keydown', { key: 'Enter' });
      await flushPromises();
      expect(document.activeElement).not.toBe(input.element);
      expect(service.patchNode.calledOnceWithExactly('outcome', 1, { title: 'Renamed outcome' })).toBe(true);
      expect(tree.byId('outcome-1')?.title).toBe('Renamed outcome');
      expect(wrapper.find('[data-cy="ost-panel-error"]').exists()).toBe(false);
    });

    it('commits the title on blur, trimmed, and shows the stored title', async () => {
      const { wrapper, service, tree } = await mountPanel('outcome-1');
      service.patchNode.resolves(dto('outcome-1', 'project-1', { title: 'Renamed outcome' }));
      const input = wrapper.get('[data-cy="ost-panel-title"]');
      await input.trigger('focus');
      await input.setValue('  Renamed outcome  ');
      expect(service.patchNode.called).toBe(false); // nothing while typing
      await input.trigger('blur');
      expect(tree.byId('outcome-1')?.title).toBe('Renamed outcome'); // shown at once
      await flushPromises();
      expect(service.patchNode.calledOnceWithExactly('outcome', 1, { title: 'Renamed outcome' })).toBe(true);
      expect((input.element as HTMLInputElement).value).toBe('Renamed outcome');
    });

    it('sends nothing when the title is unchanged (surrounding spaces do not count)', async () => {
      const { wrapper, service } = await mountPanel('outcome-1');
      const input = wrapper.get('[data-cy="ost-panel-title"]');
      await input.trigger('focus');
      await input.trigger('blur');
      await input.trigger('focus');
      await input.setValue(' Weekly interviews  ');
      await input.trigger('blur');
      await flushPromises();
      expect(service.patchNode.called).toBe(false);
      expect((input.element as HTMLInputElement).value).toBe('Weekly interviews');
      expect(wrapper.find('[data-cy="ost-panel-error"]').exists()).toBe(false);
    });

    it('Escape cancels the title edit and keeps focus in the field', async () => {
      const { wrapper, service } = await mountPanel('outcome-1');
      const input = wrapper.get('[data-cy="ost-panel-title"]');
      (input.element as HTMLInputElement).focus();
      await input.setValue('Something else');
      await input.trigger('keydown', { key: 'Escape' });
      await flushPromises();
      expect(service.patchNode.called).toBe(false);
      expect((input.element as HTMLInputElement).value).toBe('Weekly interviews');
      expect(document.activeElement).toBe(input.element);
      // Leaving the field afterwards commits nothing.
      await input.trigger('blur');
      await flushPromises();
      expect(service.patchNode.called).toBe(false);
    });

    it('a focused but untouched title field follows a rename made elsewhere; a typed edit is kept', async () => {
      const { wrapper, service, tree } = await mountPanel('outcome-1');
      const input = wrapper.get('[data-cy="ost-panel-title"]');
      const field = input.element as HTMLInputElement;
      // Focus lands in the field before the canvas rename's title reaches the store.
      field.focus();
      await input.trigger('focus');
      tree.byId('outcome-1')!.title = 'Renamed on the canvas';
      await flushPromises();
      expect(field.value).toBe('Renamed on the canvas');
      // Typing from there edits the NEW title, and leaving the field saves exactly that.
      service.patchNode.resolves(dto('outcome-1', 'project-1', { title: 'Renamed on the canvas yz' }));
      await input.setValue('Renamed on the canvas yz');
      tree.byId('outcome-1')!.title = 'Changed underneath';
      await flushPromises();
      expect(field.value).toBe('Renamed on the canvas yz'); // the user's own typing is never overwritten
      await input.trigger('blur');
      await flushPromises();
      expect(service.patchNode.lastCall.args).toEqual(['outcome', 1, { title: 'Renamed on the canvas yz' }]);
      // Afterwards the field follows the store again.
      tree.byId('outcome-1')!.title = 'A later title';
      await flushPromises();
      expect(field.value).toBe('A later title');
    });

    it('focusing the field picks up a title changed while it was not being edited', async () => {
      const { wrapper, tree } = await mountPanel('outcome-1');
      const input = wrapper.get('[data-cy="ost-panel-title"]');
      tree.byId('outcome-1')!.title = 'Changed meanwhile';
      await input.trigger('focus');
      expect((input.element as HTMLInputElement).value).toBe('Changed meanwhile');
    });

    it('a title being typed does not leak into the next node selected', async () => {
      const { wrapper, ui } = await mountPanel('outcome-1');
      const input = wrapper.get('[data-cy="ost-panel-title"]');
      await input.trigger('focus');
      await input.setValue('Half-typed');
      ui.select('solution-1');
      await flushPromises();
      expect((input.element as HTMLInputElement).value).toBe('In-app invite');
    });

    it('shows a refused title inline and rolls it back', async () => {
      const { wrapper, service, tree } = await mountPanel('outcome-1');
      service.patchNode.rejects(new RuleError('invalidtitle'));
      const input = wrapper.get('[data-cy="ost-panel-title"]');
      await input.setValue('No good');
      await input.trigger('blur');
      await flushPromises();
      const error = wrapper.get('[data-cy="ost-panel-error"]');
      expect(error.text()).toBe('Titles need 2 to 200 characters.');
      expect(error.attributes('role')).toBe('alert');
      expect(tree.error).toBeNull(); // moved from the toast into the panel
      expect(tree.byId('outcome-1')?.title).toBe('Weekly interviews');
      expect((input.element as HTMLInputElement).value).toBe('Weekly interviews');
    });

    it('a title that fails for no known rule shows the generic message', async () => {
      const { wrapper, service, tree } = await mountPanel('outcome-1');
      service.patchNode.rejects(new Error('boom'));
      const input = wrapper.get('[data-cy="ost-panel-title"]');
      await input.setValue('Fine title');
      await input.trigger('blur');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('Something went wrong. Your change was not saved.');
      expect(tree.byId('outcome-1')?.title).toBe('Weekly interviews');
    });

    it('says why an emptied title snapped back instead of reverting in silence', async () => {
      const { wrapper, service, tree } = await mountPanel('outcome-1');
      const input = wrapper.get('[data-cy="ost-panel-title"]');
      await input.setValue('   ');
      await input.trigger('blur');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('A title is required.');
      expect(tree.byId('outcome-1')?.title).toBe('Weekly interviews');
      expect((input.element as HTMLInputElement).value).toBe('Weekly interviews');
      expect(service.patchNode.called).toBe(false);
    });

    it('a one-character title snaps back with the minimum length', async () => {
      const { wrapper, service } = await mountPanel('outcome-1');
      const input = wrapper.get('[data-cy="ost-panel-title"]');
      await input.setValue(' x ');
      await input.trigger('blur');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('Titles need at least 2 characters.');
      expect((input.element as HTMLInputElement).value).toBe('Weekly interviews');
      expect(service.patchNode.called).toBe(false);
    });

    it.each([
      ['project-1', '100'],
      ['outcome-1', '200'],
      ['opportunity-1', '200'],
      ['solution-1', '200'],
      ['assumption-1', '500'],
      ['evidence-1', '500'],
    ])('%s: title maxlength %s', async (key, max) => {
      const { wrapper } = await mountPanel(key);
      expect(wrapper.get('[data-cy="ost-panel-title"]').attributes('maxlength')).toBe(max);
    });

    it('explains a refused title with the rule of the node type', async () => {
      const { wrapper, service } = await mountPanel('project-1');
      service.patchNode.rejects(new RuleError('invalidtitle'));
      const input = wrapper.get('[data-cy="ost-panel-title"]');
      await input.setValue('Project that is fine locally');
      await input.trigger('blur');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('Project names need 2 to 100 characters.');
    });
  });

  describe('error slot', () => {
    async function withError() {
      const ctx = await mountPanel('outcome-1');
      const input = ctx.wrapper.get('[data-cy="ost-panel-title"]');
      await input.setValue('');
      await input.trigger('blur');
      await flushPromises();
      expect(ctx.wrapper.find('[data-cy="ost-panel-error"]').exists()).toBe(true);
      return { ...ctx, input };
    }

    it('can be dismissed', async () => {
      const { wrapper } = await withError();
      await wrapper.get('[data-cy="ost-panel-error"] button').trigger('click');
      expect(wrapper.find('[data-cy="ost-panel-error"]').exists()).toBe(false);
    });

    it('is cleared by the next edit that works', async () => {
      const { wrapper, service, input } = await withError();
      service.patchNode.resolves(dto('outcome-1', 'project-1', { title: 'Renamed outcome' }));
      await input.setValue('Renamed outcome');
      await input.trigger('blur');
      await flushPromises();
      expect(wrapper.find('[data-cy="ost-panel-error"]').exists()).toBe(false);
    });

    it('a new selection starts with a clean slot, also when coming back', async () => {
      const { wrapper, ui } = await withError();
      ui.select('solution-1');
      await flushPromises();
      expect(wrapper.find('[data-cy="ost-panel-error"]').exists()).toBe(false);
      ui.select('outcome-1');
      await flushPromises();
      expect(wrapper.find('[data-cy="ost-panel-error"]').exists()).toBe(false);
    });

    it('a failure that returns after the selection changed is not shown against the new node', async () => {
      const { wrapper, service, tree, ui } = await mountPanel('outcome-1');
      let reject!: (e: unknown) => void;
      service.patchNode.returns(new Promise((_, r) => (reject = r)) as any);
      const input = wrapper.get('[data-cy="ost-panel-title"]');
      await input.setValue('Renamed outcome');
      await input.trigger('blur');
      ui.select('solution-1');
      await flushPromises();
      reject(new Error('boom'));
      await flushPromises();
      expect(wrapper.find('[data-cy="ost-panel-error"]').exists()).toBe(false);
      // left on the toast, labelled with the node it was about
      expect(tree.error).toBe('“Weekly interviews”: Something went wrong. Your change was not saved.');
      expect(tree.byId('outcome-1')?.title).toBe('Weekly interviews');
    });
  });

  describe('tabs: keyboard and ARIA', () => {
    it('aria-controls / tabpanel wiring and a roving tabindex', async () => {
      const { wrapper } = await mountPanel('opportunity-1');
      expect(wrapper.get('[role="tablist"]').attributes('aria-label')).toBe('Node details');
      const active = wrapper.get('[data-cy="ost-tab-detail"]');
      const panel = wrapper.get('[role="tabpanel"]');
      expect(active.attributes('role')).toBe('tab');
      expect(active.attributes('aria-controls')).toBe(panel.attributes('id'));
      expect(panel.attributes('aria-labelledby')).toBe(active.attributes('id'));
      expect(active.attributes('tabindex')).toBe('0');
      expect(wrapper.get('[data-cy="ost-tab-links"]').attributes('tabindex')).toBe('-1');
      expect(wrapper.get('[data-cy="ost-tab-links"]').attributes('aria-controls')).toBeUndefined();
    });

    it('the wiring moves with the active tab', async () => {
      const { wrapper } = await mountPanel('opportunity-1');
      await wrapper.get('[data-cy="ost-tab-questions"]').trigger('click');
      const active = wrapper.get('[data-cy="ost-tab-questions"]');
      const panel = wrapper.get('[role="tabpanel"]');
      expect(active.attributes('tabindex')).toBe('0');
      expect(active.attributes('aria-controls')).toBe(panel.attributes('id'));
      expect(panel.attributes('aria-labelledby')).toBe(active.attributes('id'));
      expect(wrapper.get('[data-cy="ost-tab-detail"]').attributes('tabindex')).toBe('-1');
    });

    it('arrow keys (wrapping), Home and End select and focus', async () => {
      const { wrapper, ui } = await mountPanel('opportunity-1');
      const list = wrapper.get('[role="tablist"]');
      await list.trigger('keydown', { key: 'ArrowRight' });
      await flushPromises();
      expect(ui.panelTab).toBe('links');
      expect(document.activeElement?.getAttribute('data-cy')).toBe('ost-tab-links');
      await list.trigger('keydown', { key: 'End' });
      await flushPromises();
      expect(ui.panelTab).toBe('questions');
      expect(document.activeElement?.getAttribute('data-cy')).toBe('ost-tab-questions');
      await list.trigger('keydown', { key: 'ArrowRight' });
      await flushPromises();
      expect(ui.panelTab).toBe('detail');
      await list.trigger('keydown', { key: 'ArrowLeft' });
      await flushPromises();
      expect(ui.panelTab).toBe('questions');
      await list.trigger('keydown', { key: 'ArrowLeft' });
      await flushPromises();
      expect(ui.panelTab).toBe('links');
      await list.trigger('keydown', { key: 'Home' });
      await flushPromises();
      expect(ui.panelTab).toBe('detail');
      expect(document.activeElement?.getAttribute('data-cy')).toBe('ost-tab-detail');
    });

    it('other keys leave the tab alone', async () => {
      const { wrapper, ui } = await mountPanel('opportunity-1');
      const list = wrapper.get('[role="tablist"]');
      await list.trigger('keydown', { key: 'ArrowDown' });
      await list.trigger('keydown', { key: 'a' });
      await flushPromises();
      expect(ui.panelTab).toBe('detail');
    });

    it('End on a type without Open Qs stops at Links', async () => {
      const { wrapper, ui } = await mountPanel('solution-1');
      await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'End' });
      await flushPromises();
      expect(ui.panelTab).toBe('links');
    });
  });

  describe('hide and reopen', () => {
    it('hiding keeps the selection and leaves a Details tab that reopens the panel', async () => {
      const { wrapper, ui } = await mountPanel('solution-1');
      await wrapper.get('[data-cy="ost-panel-hide"]').trigger('click');
      expect(ui.rightOpen).toBe(false);
      expect(ui.selectedId).toBe('solution-1');
      expect(wrapper.find('[data-cy="ost-panel"]').exists()).toBe(false);
      expect(wrapper.get('[data-cy="ost-panel-reopen"]').text()).toBe('Details');
      await wrapper.get('[data-cy="ost-panel-reopen"]').trigger('click');
      expect(ui.rightOpen).toBe(true);
      expect(wrapper.find('[data-cy="ost-panel"]').exists()).toBe(true);
      expect(wrapper.find('[data-cy="ost-panel-reopen"]').exists()).toBe(false);
    });

    it('a node selection reopens a hidden panel', async () => {
      const { wrapper, ui } = await mountPanel('solution-1');
      ui.setRightOpen(false);
      await flushPromises();
      ui.select('solution-2');
      await flushPromises();
      expect(wrapper.find('[data-cy="ost-panel"]').exists()).toBe(true);
      expect((wrapper.get('[data-cy="ost-panel-title"]').element as HTMLInputElement).value).toBe('Lonely solution');
    });

    it('hide moves focus to the Details tab, reopening moves it back to the hide button', async () => {
      const { wrapper } = await mountPanel('solution-1');
      await wrapper.get('[data-cy="ost-panel-hide"]').trigger('click');
      await flushPromises();
      expect(document.activeElement?.getAttribute('data-cy')).toBe('ost-panel-reopen');
      await wrapper.get('[data-cy="ost-panel-reopen"]').trigger('click');
      await flushPromises();
      expect(document.activeElement?.getAttribute('data-cy')).toBe('ost-panel-hide');
    });
  });

  describe('footer', () => {
    it('asks to delete the selected node (the confirmation is not the panel’s)', async () => {
      const { wrapper, ui, service } = await mountPanel('solution-1');
      await wrapper.get('[data-cy="ost-delete"]').trigger('click');
      expect(ui.confirmId).toBe('solution-1');
      expect(service.deleteNode.called).toBe(false);
    });

    it('has Delete as its only action', async () => {
      const { wrapper } = await mountPanel('solution-1');
      const actions = wrapper.findAll('.ost-panel__footer button, .ost-panel__footer a');
      expect(actions.map(a => a.text())).toEqual(['Delete']);
    });
  });

  it('closes when the selected node is deleted', async () => {
    const { wrapper, service, tree } = await mountPanel('solution-1');
    service.deleteNode.resolves();
    await tree.deleteNode('solution-1');
    await flushPromises();
    expect(wrapper.find('[data-cy="ost-panel"]').exists()).toBe(false);
    expect(wrapper.find('[data-cy="ost-panel-reopen"]').exists()).toBe(false);
  });
  describe('a sub-project', () => {
    async function nestedPanel(select: string) {
      const ctx = await setupStores([
        dto('project-1', null),
        dto('outcome-1', 'project-1'),
        dto('project-2', 'project-1'),
        dto('project-3', 'project-2'),
      ]);
      ctx.ui.select(select);
      const wrapper = await mountWith(DetailPanel, ctx.pinia);
      return { ...ctx, wrapper };
    }

    it('shows the projects it sits in as its breadcrumb', async () => {
      const { wrapper } = await nestedPanel('project-3');
      expect(wrapper.get('[data-cy="ost-panel-kicker"]').text()).toBe('Project');
      expect(wrapper.findAll('[data-cy^="ost-breadcrumb-"]').map(c => c.attributes('data-cy'))).toEqual([
        'ost-breadcrumb-project-1',
        'ost-breadcrumb-project-2',
      ]);
    });

    it('offers "Move to top level" on a sub-project only', async () => {
      for (const [key, offered] of [
        ['project-1', false],
        ['outcome-1', false],
        ['project-2', true],
        ['project-3', true],
      ] as const) {
        const { wrapper } = await nestedPanel(key);
        expect(wrapper.find('[data-cy="ost-move-top"]').exists(), key).toBe(offered);
        wrapper.unmount();
      }
    });

    it('"Move to top level" moves the project out of its parent and brings it into view', async () => {
      const { wrapper, service, tree, ui } = await nestedPanel('project-3');
      service.moveNode.resolves({ node: dto('project-3', null, { sortOrder: 1 }), siblings: [{ key: 'project-3', sortOrder: 1 }] });
      await wrapper.get('[data-cy="ost-move-top"]').trigger('click');
      await flushPromises();
      expect(service.moveNode.calledOnceWithExactly({ nodeType: 'PROJECT', nodeId: 3, parentType: null, parentId: null })).toBe(true);
      expect(tree.byId('project-3')?.parent).toBeNull();
      expect(ui.selectedId).toBe('project-3');
      expect(ui.centreRequest?.key).toBe('project-3');
      expect(wrapper.find('[data-cy="ost-move-top"]').exists()).toBe(false);
    });

    it('a refused move is reported in the panel and changes nothing', async () => {
      const { wrapper, service, tree } = await nestedPanel('project-3');
      service.moveNode.rejects(new RuleError('nodemissing'));
      await wrapper.get('[data-cy="ost-move-top"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toContain('That node no longer exists.');
      expect(tree.byId('project-3')?.parent).toBe('project-2');
    });
  });
});
