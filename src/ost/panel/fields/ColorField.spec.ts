import { afterEach, describe, expect, it } from 'vitest';

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';

import { dto } from '../../domain/fixtures.test-util';
import { NODE_COLORS, NODE_COLOR_LABEL } from '../../domain/node-colors';
import { RuleError } from '../../ost-errors';
import DetailPanel from '../DetailPanel.vue';
import { PANEL_TREE, mountWith, setupStores } from '../panel.test-util';
import DetailTab from '../tabs/DetailTab.vue';

import ColorField from './ColorField.vue';

enableAutoUnmount(afterEach);

const mountField = (value: unknown = null) => mount(ColorField, { props: { value: value as never }, attachTo: document.body });
const swatches = (wrapper: ReturnType<typeof mountField>) => wrapper.findAll('[role="radio"]');
const key = (wrapper: ReturnType<typeof mountField>, name: string) =>
  (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })) &&
  wrapper.vm.$nextTick();
const focused = () => (document.activeElement as HTMLElement).getAttribute('data-cy');

describe('ColorField', () => {
  it('is a labelled radio group: Default first, then every colour of the palette', () => {
    const wrapper = mountField();
    const group = wrapper.get('[role="radiogroup"]');
    expect(document.getElementById(group.attributes('aria-labelledby')!)!.textContent).toBe('Colour');
    expect(swatches(wrapper).map(s => s.attributes('data-cy'))).toEqual(['ost-color-default', ...NODE_COLORS.map(c => `ost-color-${c}`)]);
    for (const swatch of swatches(wrapper)) {
      expect(swatch.element.tagName).toBe('BUTTON');
      expect(swatch.attributes('type')).toBe('button');
    }
  });

  it('names every swatch by its colour, as accessible name and as tooltip, never by a value', () => {
    const wrapper = mountField();
    const names = swatches(wrapper).map(s => s.attributes('aria-label'));
    expect(names).toEqual(['Default', ...NODE_COLORS.map(c => NODE_COLOR_LABEL[c])]);
    expect(swatches(wrapper).map(s => s.attributes('title'))).toEqual(names);
    for (const name of names) expect(name).not.toMatch(/#|rgb|\d/);
  });

  it('colours a swatch through data-ost-color; Default carries none', () => {
    const wrapper = mountField();
    expect(swatches(wrapper).map(s => s.attributes('data-ost-color'))).toEqual([undefined, ...NODE_COLORS]);
    // No colour value is ever written into a style.
    for (const swatch of swatches(wrapper)) expect(swatch.attributes('style')).toBeUndefined();
  });

  it.each([null, ...NODE_COLORS])('marks the current one (%s): checked, in the tab order, and named beside the label', value => {
    const wrapper = mountField(value);
    const id = `ost-color-${value ?? 'default'}`;
    for (const swatch of swatches(wrapper)) {
      const on = swatch.attributes('data-cy') === id;
      expect(swatch.attributes('aria-checked')).toBe(String(on));
      expect(swatch.attributes('tabindex')).toBe(on ? '0' : '-1');
      expect(swatch.classes('is-on')).toBe(on);
      expect(swatch.find('svg').exists()).toBe(on);
    }
    expect(wrapper.get('[data-cy="ost-color-label"]').text()).toBe(value ? NODE_COLOR_LABEL[value] : 'Default');
  });

  it('a value that is not a colour of the palette shows as Default', () => {
    const wrapper = mountField('red; background:url(https://example.com)');
    expect(wrapper.get('[data-cy="ost-color-default"]').attributes('aria-checked')).toBe('true');
    expect(wrapper.html()).not.toContain('example.com');
  });

  it('a click chooses a colour; a click on the current one does nothing', async () => {
    const wrapper = mountField('teal');
    await wrapper.get('[data-cy="ost-color-blue"]').trigger('click');
    await wrapper.get('[data-cy="ost-color-teal"]').trigger('click');
    await wrapper.get('[data-cy="ost-color-default"]').trigger('click');
    expect(wrapper.emitted('change')).toEqual([['blue'], [null]]);
  });

  it('arrow keys, Home and End move between swatches without choosing; they wrap', async () => {
    const wrapper = mountField('red');
    (wrapper.get('[data-cy="ost-color-red"]').element as HTMLElement).focus();
    await key(wrapper, 'ArrowRight');
    expect(focused()).toBe('ost-color-orange');
    await key(wrapper, 'ArrowDown');
    expect(focused()).toBe('ost-color-yellow');
    await key(wrapper, 'ArrowLeft');
    await key(wrapper, 'ArrowUp');
    await key(wrapper, 'ArrowLeft');
    expect(focused()).toBe('ost-color-default');
    await key(wrapper, 'ArrowLeft');
    expect(focused()).toBe('ost-color-grey');
    await key(wrapper, 'ArrowRight');
    expect(focused()).toBe('ost-color-default');
    await key(wrapper, 'End');
    expect(focused()).toBe('ost-color-grey');
    await key(wrapper, 'Home');
    expect(focused()).toBe('ost-color-default');
    expect(wrapper.emitted('change')).toBeUndefined();
  });

  it('leaves modified arrows alone (Alt+arrows belong to the canvas)', async () => {
    const wrapper = mountField('red');
    const red = wrapper.get('[data-cy="ost-color-red"]').element as HTMLElement;
    red.focus();
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true });
    red.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(focused()).toBe('ost-color-red');
  });

  it('every swatch is a touch target (.ost-tap: 44px on a coarse pointer)', () => {
    for (const swatch of swatches(mountField())) expect(swatch.classes()).toContain('ost-tap');
  });
});

describe('the colour row on the Detail tab', () => {
  it.each(['project-1', 'outcome-1', 'opportunity-1', 'solution-1', 'assumption-1', 'evidence-1'])('is there for %s', async nodeKey => {
    const ctx = await setupStores();
    const wrapper = await mountWith(DetailTab, ctx.pinia, { nodeKey });
    expect(wrapper.findAll('[data-cy="ost-colors"] [role="radio"]')).toHaveLength(NODE_COLORS.length + 1);
    expect(wrapper.get('[data-cy="ost-color-default"]').attributes('aria-checked')).toBe('true');
  });

  it('shows the colour the node has', async () => {
    const tree = PANEL_TREE.map(n => (n.key === 'solution-1' ? { ...n, color: 'green' } : n));
    const ctx = await setupStores(tree);
    const wrapper = await mountWith(DetailTab, ctx.pinia, { nodeKey: 'solution-1' });
    expect(wrapper.get('[data-cy="ost-color-green"]').attributes('aria-checked')).toBe('true');
    expect(wrapper.get('[data-cy="ost-color-label"]').text()).toBe('Green');
  });

  it('choosing a colour patches the node by name, and the swatch follows', async () => {
    const ctx = await setupStores();
    ctx.service.patchNode.resolves(dto('evidence-1', 'assumption-2', { title: 'Test result', color: 'teal' }));
    const wrapper = await mountWith(DetailTab, ctx.pinia, { nodeKey: 'evidence-1' });
    await wrapper.get('[data-cy="ost-color-teal"]').trigger('click');
    await flushPromises();
    expect(ctx.service.patchNode.calledOnceWithExactly('evidence', 1, { color: 'teal' })).toBe(true);
    expect(ctx.tree.byId('evidence-1')!.color).toBe('teal');
    expect(wrapper.get('[data-cy="ost-color-teal"]').attributes('aria-checked')).toBe('true');
  });

  it('Default sends null', async () => {
    const tree = PANEL_TREE.map(n => (n.key === 'outcome-1' ? { ...n, color: 'red' } : n));
    const ctx = await setupStores(tree);
    ctx.service.patchNode.resolves(dto('outcome-1', 'project-1', { title: 'Weekly interviews' }));
    const wrapper = await mountWith(DetailTab, ctx.pinia, { nodeKey: 'outcome-1' });
    await wrapper.get('[data-cy="ost-color-default"]').trigger('click');
    await flushPromises();
    expect(ctx.service.patchNode.calledOnceWithExactly('outcome', 1, { color: null })).toBe(true);
    expect(ctx.tree.byId('outcome-1')!.color).toBeNull();
  });

  it('a refused change goes back to the colour it was, with a message in the panel', async () => {
    const tree = PANEL_TREE.map(n => (n.key === 'solution-1' ? { ...n, color: 'green' } : n));
    const ctx = await setupStores(tree);
    ctx.ui.select('solution-1');
    ctx.service.patchNode.rejects(new RuleError('invalidcolor'));
    const wrapper = await mountWith(DetailPanel, ctx.pinia);
    await wrapper.get('[data-cy="ost-color-blue"]').trigger('click');
    await flushPromises();
    expect(ctx.tree.byId('solution-1')!.color).toBe('green');
    expect(wrapper.get('[data-cy="ost-color-green"]').attributes('aria-checked')).toBe('true');
    expect(wrapper.text()).toContain('That colour is not one of the node colours.');
  });
});
