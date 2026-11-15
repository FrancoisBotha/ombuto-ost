import { afterEach, describe, expect, it } from 'vitest';

import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';

import type { NodeType } from '../domain/types';

import AddChildMenu from './AddChildMenu.vue';

describe('AddChildMenu', () => {
  let wrapper: VueWrapper | null = null;

  const open = async (parentType: NodeType, trigger: HTMLElement | null = null) => {
    wrapper = mount(AddChildMenu, { props: { parentType, parentTitle: 'Parent', trigger }, attachTo: document.body });
    await flushPromises();
    return wrapper;
  };
  const items = (w: VueWrapper) => w.findAll('[role="menuitem"]').map(b => b.attributes('data-cy'));

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
  });

  const cases: [NodeType, string[]][] = [
    ['project', ['Outcome', 'Project']],
    ['outcome', ['Opportunity']],
    ['opportunity', ['Opportunity', 'Solution', 'Evidence']],
    ['solution', ['Assumption']],
    ['assumption', ['Evidence']],
  ];

  it.each(cases)('under a %s it lists exactly %j', async (type, labels) => {
    const w = await open(type);
    expect(w.findAll('[role="menuitem"]').map(b => b.text())).toEqual(labels);
    expect(items(w)).toEqual(labels.map(l => `ost-add-menu-${l.toLowerCase()}`));
    expect(w.get('[data-cy="ost-add-menu"]').attributes('role')).toBe('menu');
    expect(w.text()).toContain('Add child');
  });

  it('solutions never offer evidence (evidence goes under opportunities and assumptions)', async () => {
    const w = await open('solution');
    expect(w.find('[data-cy="ost-add-menu-evidence"]').exists()).toBe(false);
  });

  it('emits the chosen type', async () => {
    const w = await open('opportunity');
    await w.get('[data-cy="ost-add-menu-solution"]').trigger('click');
    expect(w.emitted('choose')).toEqual([['solution']]);
  });

  it('focuses the first item and moves with the arrow keys, Home and End', async () => {
    const w = await open('opportunity');
    const [first, second, third] = w.findAll('[role="menuitem"]').map(b => b.element as HTMLElement);
    expect(document.activeElement).toBe(first);
    await w.get('[role="menu"]').trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    await w.get('[role="menu"]').trigger('keydown', { key: 'End' });
    expect(document.activeElement).toBe(third);
    await w.get('[role="menu"]').trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);
    await w.get('[role="menu"]').trigger('keydown', { key: 'ArrowUp' });
    expect(document.activeElement).toBe(third);
    await w.get('[role="menu"]').trigger('keydown', { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });

  it('offers "Move to top level" on a sub-project only, below the child types, and asks for the move', async () => {
    const plain = await open('project');
    expect(plain.find('[data-cy="ost-add-menu-move-top"]').exists()).toBe(false);
    plain.unmount();

    wrapper = mount(AddChildMenu, { props: { parentType: 'project', parentTitle: 'Sub', canMoveTop: true }, attachTo: document.body });
    await flushPromises();
    expect(items(wrapper)).toEqual(['ost-add-menu-outcome', 'ost-add-menu-project', 'ost-add-menu-move-top']);
    expect(wrapper.find('[role="separator"]').exists()).toBe(true);
    const item = wrapper.get('[data-cy="ost-add-menu-move-top"]');
    expect(item.text()).toBe('Move to top level');
    await item.trigger('click');
    expect(wrapper.emitted('moveTop')).toHaveLength(1);
    expect(wrapper.emitted('choose')).toBeUndefined();
    // It is part of the menu's keyboard loop: End lands on it.
    await wrapper.get('[role="menu"]').trigger('keydown', { key: 'End' });
    expect(document.activeElement).toBe(item.element);
  });

  it('Escape closes and asks for focus back on the +; Tab closes without it', async () => {
    const w = await open('outcome');
    await w.get('[role="menu"]').trigger('keydown', { key: 'Escape' });
    await w.get('[role="menu"]').trigger('keydown', { key: 'Tab' });
    expect(w.emitted('close')).toEqual([[true], [false]]);
  });

  it('a press outside the menu and its + closes it; inside does not', async () => {
    const trigger = document.createElement('button');
    const outside = document.createElement('div');
    document.body.append(trigger, outside);
    const w = await open('outcome', trigger);
    w.get('[data-cy="ost-add-menu-opportunity"]').element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    trigger.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(w.emitted('close')).toBeUndefined();
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(w.emitted('close')).toEqual([[false]]);
  });

  it('reports close (without refocus) when it is unmounted while open', async () => {
    const w = await open('outcome');
    expect(w.emitted('close')).toBeUndefined();
    w.unmount();
    wrapper = null;
    expect(w.emitted('close')).toEqual([[false]]);
  });
});
