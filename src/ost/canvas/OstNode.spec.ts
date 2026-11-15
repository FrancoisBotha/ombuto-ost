import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { mount } from '@vue/test-utils';

import { node } from '../domain/fixtures.test-util';
import { NODE_COLORS } from '../domain/node-colors';
import { priorityColor } from '../domain/rules';
import type { NodeType, OstNode } from '../domain/types';

import OstNodeView from './OstNode.vue';

const HandleStub = { name: 'Handle', template: '<i class="handle-stub"></i>' };

function mountNode(n: OstNode, props: Record<string, unknown> = {}) {
  return mount(OstNodeView, {
    props: { node: n, ...props },
    global: { stubs: { Handle: HandleStub } },
  });
}

/** The dot colour (happy-dom drops oklch() from inline styles, so the node mirrors it in data-color). */
const bg = (el: Element) => el.getAttribute('data-color');

describe('OstNode', () => {
  describe('frames', () => {
    const cases: [NodeType, string, number][] = [
      ['project', 'Project', 244],
      ['outcome', 'Outcome', 238],
      ['opportunity', 'Opportunity', 218],
      ['solution', 'Solution', 206],
      ['assumption', 'Assumption', 198],
      ['evidence', 'Evidence', 206],
    ];

    it.each(cases)('%s gets its own frame class, kicker and box width', (type, label, width) => {
      const wrapper = mountNode(node(`${type}-1`, type === 'project' ? null : 'x-1'));
      const root = wrapper.get('.ost-node');
      expect(root.classes()).toContain(`ost-node--${type}`);
      // exactly one frame class
      expect(root.classes().filter(c => /^ost-node--/.test(c))).toEqual([`ost-node--${type}`]);
      expect(wrapper.get('.ost-node__kicker').text()).toBe(label);
      expect(root.attributes('style')).toContain(`width: ${width}px`);
      expect(root.attributes('data-cy')).toBe(`ost-node-${type}-1`);
    });

    it('shows the title', () => {
      const wrapper = mountNode(node('outcome-1', 'project-1', { title: 'Teams interview weekly' }));
      expect(wrapper.get('[data-cy="ost-node-title"]').text()).toBe('Teams interview weekly');
    });

    it('projects have no meta row', () => {
      const wrapper = mountNode(node('project-1', null));
      expect(wrapper.find('.ost-node__meta').exists()).toBe(false);
      expect(wrapper.find('.ost-node__meta').exists()).toBe(false);
    });
  });

  describe('status badge tones', () => {
    it.each([
      ['validated', 'good'],
      ['supported', 'good'],
      ['shipped', 'good'],
      ['exploring', 'flight'],
      ['unexplored', 'flight'],
      ['testing', 'flight'],
      ['untested', 'flight'],
      ['candidate', 'flight'],
      ['building', 'flight'],
      ['refuted', 'bad'],
      ['dropped', 'bad'],
      ['parked', 'bad'],
    ])('%s → %s', (status, tone) => {
      const type: NodeType = ['validated', 'exploring', 'unexplored', 'parked'].includes(status)
        ? 'opportunity'
        : ['shipped', 'candidate', 'building', 'dropped'].includes(status)
          ? 'solution'
          : 'assumption';
      const wrapper = mountNode(node(`${type}-1`, 'x-1', { status }));
      const badge = wrapper.get('[data-cy="ost-node-status"]');
      expect(badge.text()).toBe(status);
      expect(badge.classes()).toContain(`ost-node__badge--${tone}`);
      expect(badge.attributes('data-tone')).toBe(tone);
    });

    it('no badge without a status', () => {
      expect(mountNode(node('outcome-1', 'project-1')).find('[data-cy="ost-node-status"]').exists()).toBe(false);
    });
  });

  describe('one metric per type', () => {
    it('assumptions show confidence', () => {
      const wrapper = mountNode(node('assumption-1', 'solution-1', { status: 'testing', conf: 65 }));
      expect(wrapper.get('[data-cy="ost-node-metric"]').text()).toBe('65% confidence');
      expect(wrapper.find('[data-cy="ost-node-value"]').exists()).toBe(false);
    });

    it('solutions show no metric: the evidence roll-up was dropped from the card and lives in the detail panel', () => {
      const solution = node('solution-1', 'opportunity-1', { status: 'building' });
      expect(mountNode(solution).find('[data-cy="ost-node-metric"]').exists()).toBe(false);
    });

    it('outcomes and evidence show no metric', () => {
      expect(mountNode(node('outcome-1', 'project-1')).find('[data-cy="ost-node-metric"]').exists()).toBe(false);
      expect(mountNode(node('evidence-1', 'opportunity-1')).find('[data-cy="ost-node-metric"]').exists()).toBe(false);
    });
  });

  describe('opportunity value ($ glyphs)', () => {
    it.each([1, 3, 5])('value %i → %i filled of 5', value => {
      const wrapper = mountNode(node('opportunity-1', 'outcome-1', { status: 'exploring', value }));
      expect(wrapper.get('.ost-node__money-on').text()).toBe('$'.repeat(value));
      expect(wrapper.get('.ost-node__money-off').text()).toBe('$'.repeat(5 - value));
    });

    it('only opportunities show $', () => {
      expect(
        mountNode(node('solution-1', 'opportunity-1', { value: 4 }))
          .find('[data-cy="ost-node-value"]')
          .exists(),
      ).toBe(false);
    });
  });

  describe('priority rail', () => {
    const dots = (priority: number) =>
      mountNode(node('opportunity-1', 'outcome-1', { status: 'exploring', priority }))
        .get('[data-cy="ost-node-priority"]')
        .findAll('i');

    it('always has five dots, top = highest band', () => {
      expect(dots(50)).toHaveLength(5);
    });

    it.each([
      [1, 1],
      [20, 1],
      [21, 2],
      [50, 3],
      [80, 4],
      [92, 5],
      [100, 5],
    ])('priority %i fills %i dots', (priority, filled) => {
      const list = dots(priority);
      expect(list.filter(d => d.attributes('data-filled') === 'true')).toHaveLength(filled);
      // filled dots are the BOTTOM ones (rail reads bottom-up)
      expect(list.map(d => d.attributes('data-filled'))).toEqual([...Array(5 - filled).fill('false'), ...Array(filled).fill('true')]);
    });

    it('filled dots take the oklch priority colour; empty ones the neutral token', () => {
      const list = dots(92);
      const colour = priorityColor(92);
      expect(colour).toMatch(/^oklch\(0\.74 /);
      for (const d of list) expect(bg(d.element)).toBe(colour);
      const low = dots(10);
      expect(bg(low[4].element)).toBe(priorityColor(10));
      expect(bg(low[0].element)).toBe('var(--node-mute)');
    });

    it('a partly filled dot is smaller and fainter than a full one', () => {
      const list = dots(50); // bands: 5 empty, 4 empty, 3 half, 2 full, 1 full
      const full = list[4].element as HTMLElement;
      const half = list[2].element as HTMLElement;
      expect(parseFloat(full.style.width)).toBe(7);
      expect(parseFloat(half.style.width)).toBeCloseTo(5.8);
      expect(Number(half.style.opacity)).toBeLessThan(Number(full.style.opacity));
    });

    it('is on opportunities only', () => {
      expect(mountNode(node('solution-1', 'opportunity-1')).find('[data-cy="ost-node-priority"]').exists()).toBe(false);
    });
  });

  describe('+ button', () => {
    it('renders only when canAdd and emits add', async () => {
      expect(mountNode(node('outcome-1', 'project-1')).find('[data-cy="ost-node-add-outcome-1"]').exists()).toBe(false);
      const wrapper = mountNode(node('outcome-1', 'project-1'), { canAdd: true });
      await wrapper.get('[data-cy="ost-node-add-outcome-1"]').trigger('click');
      expect(wrapper.emitted('add')).toHaveLength(1);
    });
  });

  describe('collapse chip', () => {
    it('is absent without children', () => {
      expect(mountNode(node('outcome-1', 'project-1')).find('[data-cy="ost-collapse-outcome-1"]').exists()).toBe(false);
    });

    it('shows – when expanded and +n when collapsed, and emits toggle', async () => {
      const expanded = mountNode(node('outcome-1', 'project-1'), { childCount: 3 });
      const chip = expanded.get('[data-cy="ost-collapse-outcome-1"]');
      expect(chip.text()).toBe('–');
      expect(chip.attributes('aria-expanded')).toBe('true');
      await chip.trigger('click');
      expect(expanded.emitted('toggle')).toHaveLength(1);

      const collapsed = mountNode(node('outcome-1', 'project-1'), { childCount: 3, collapsed: true });
      const c = collapsed.get('[data-cy="ost-collapse-outcome-1"]');
      expect(c.text()).toBe('+3');
      expect(c.classes()).toContain('is-collapsed');
      expect(c.attributes('aria-expanded')).toBe('false');
    });
  });

  describe('states', () => {
    it('maps selected / match / dimmed / legal + hovered drop target to classes', () => {
      const wrapper = mountNode(node('solution-1', 'opportunity-1'), {
        selected: true,
        match: true,
        dimmed: true,
        legalTarget: true,
        dropTarget: true,
      });
      const root = wrapper.get('.ost-node');
      expect(root.classes()).toEqual(expect.arrayContaining(['is-selected', 'is-match', 'is-dimmed', 'is-target', 'is-drop']));
      expect(root.attributes('data-drop-target')).toBe('true');
      expect(root.attributes('data-drop-hover')).toBe('true');
      const plain = mountNode(node('solution-1', 'opportunity-1'));
      expect(plain.get('.ost-node').classes()).not.toEqual(expect.arrayContaining(['is-selected']));
      expect(plain.get('.ost-node').classes()).not.toContain('is-dimmed');
    });
  });

  describe('collapse chip names', () => {
    it('says what it does, not "–" / "+n"', () => {
      const open = mountNode(node('outcome-1', 'project-1'), { childCount: 3 }).get('[data-cy="ost-collapse-outcome-1"]');
      expect(open.attributes('aria-label')).toBe('Collapse');
      const shut = mountNode(node('outcome-1', 'project-1'), { childCount: 3, collapsed: true }).get('[data-cy="ost-collapse-outcome-1"]');
      // `childCount` is the node's DIRECT children, while collapsing hides
      // the whole subtree. The name used to say "3 hidden", which is false whenever any of those
      // three has children of its own.
      expect(shut.attributes('aria-label')).toBe('Expand, 3 children');
      expect(shut.attributes('title')).toBe('Expand (3 children)');
      const one = mountNode(node('outcome-2', 'project-1'), { childCount: 1, collapsed: true }).get('[data-cy="ost-collapse-outcome-2"]');
      expect(one.attributes('aria-label')).toBe('Expand, 1 child');
    });
  });

  describe('keyboard + accessible name', () => {
    it('is focusable with a name from type, title and status', () => {
      const root = mountNode(node('opportunity-3', 'outcome-1', { title: 'Faster onboarding', status: 'exploring' }), {
        selected: true,
      }).get('.ost-node');
      expect(root.attributes('tabindex')).toBe('0');
      expect(root.attributes('role')).toBe('group');
      expect(root.attributes('aria-label')).toBe('Opportunity: Faster onboarding, exploring, selected');
    });

    it('Enter and Space activate, F2 renames, Delete asks to delete', async () => {
      const wrapper = mountNode(node('solution-1', 'opportunity-1'));
      const root = wrapper.get('.ost-node');
      await root.trigger('keydown', { key: 'Enter' });
      await root.trigger('keydown', { key: ' ' });
      await root.trigger('keydown', { key: 'F2' });
      await root.trigger('keydown', { key: 'Delete' });
      expect(wrapper.emitted('activate')).toHaveLength(2);
      expect(wrapper.emitted('rename')).toHaveLength(1);
      expect(wrapper.emitted('delete')).toHaveLength(1);
    });

    it('Alt+Left / Alt+Right ask to move the node among its siblings, and say so to assistive tech', async () => {
      const wrapper = mountNode(node('solution-1', 'opportunity-1'));
      const root = wrapper.get('.ost-node');
      expect(root.attributes('aria-keyshortcuts')).toContain('Alt+ArrowLeft');
      await root.trigger('keydown', { key: 'ArrowLeft', altKey: true });
      await root.trigger('keydown', { key: 'ArrowRight', altKey: true });
      expect(wrapper.emitted('reorder')).toEqual([[-1], [1]]);
      // A plain arrow key is not a reorder, and a modified Enter / Delete is not ours.
      await root.trigger('keydown', { key: 'ArrowRight' });
      await root.trigger('keydown', { key: 'Enter', ctrlKey: true });
      await root.trigger('keydown', { key: 'Delete', altKey: true });
      expect(wrapper.emitted('reorder')).toHaveLength(2);
      expect(wrapper.emitted('activate')).toBeUndefined();
      expect(wrapper.emitted('delete')).toBeUndefined();
    });

    it('Alt+Up asks to move the node out one level', async () => {
      const wrapper = mountNode(node('project-2', 'project-1'));
      const root = wrapper.get('.ost-node');
      expect(root.attributes('aria-keyshortcuts')).toContain('Alt+ArrowUp');
      await root.trigger('keydown', { key: 'ArrowUp', altKey: true });
      expect(wrapper.emitted('outdent')).toHaveLength(1);
      await root.trigger('keydown', { key: 'ArrowUp' });
      await root.trigger('keydown', { key: 'ArrowDown', altKey: true });
      expect(wrapper.emitted('outdent')).toHaveLength(1);
      expect(wrapper.emitted('reorder')).toBeUndefined();
    });

    it('the + of a sub-project says it can also move the project to the top level; other nodes only add', () => {
      const sub = mountNode(node('project-2', 'project-1'), { canAdd: true });
      expect(sub.get('[data-cy="ost-node-add-project-2"]').attributes('title')).toBe('Add child, or move to top level');
      expect(sub.get('[data-cy="ost-node-add-project-2"]').attributes('aria-label')).toContain('move it to the top level');
      const top = mountNode(node('project-1', null), { canAdd: true });
      expect(top.get('[data-cy="ost-node-add-project-1"]').attributes('title')).toBe('Add child');
      const outcome = mountNode(node('outcome-1', 'project-1'), { canAdd: true });
      expect(outcome.get('[data-cy="ost-node-add-outcome-1"]').attributes('title')).toBe('Add child');
    });

    it('ignores keys that come from its own buttons', async () => {
      const wrapper = mountNode(node('outcome-1', 'project-1'), { canAdd: true });
      await wrapper.get('[data-cy="ost-node-add-outcome-1"]').trigger('keydown', { key: 'Enter' });
      expect(wrapper.emitted('activate')).toBeUndefined();
    });
  });

  describe('rename', () => {
    it('a double-click on the title asks to rename', async () => {
      const wrapper = mountNode(node('outcome-1', 'project-1'));
      await wrapper.get('[data-cy="ost-node-title"]').trigger('dblclick');
      expect(wrapper.emitted('rename')).toHaveLength(1);
    });

    it('editing swaps the title for the rename field and relays commit / cancel', async () => {
      const wrapper = mountNode(node('outcome-1', 'project-1', { title: 'Old' }), { editing: true });
      expect(wrapper.find('[data-cy="ost-node-title"]').exists()).toBe(false);
      const input = wrapper.get('[data-cy="ost-rename-input"]');
      expect((input.element as HTMLInputElement).value).toBe('Old');
      await input.setValue('New');
      await input.trigger('keydown', { key: 'Enter' });
      expect(wrapper.emitted('renameCommit')).toEqual([['New']]);
    });

    it('reopens with a refused draft and its message', () => {
      const wrapper = mountNode(node('outcome-1', 'project-1', { title: 'Old' }), {
        editing: true,
        editDraft: 'Refused',
        editError: 'Nope.',
      });
      expect((wrapper.get('[data-cy="ost-rename-input"]').element as HTMLInputElement).value).toBe('Refused');
      expect(wrapper.get('[data-cy="ost-rename-error"]').text()).toBe('Nope.');
    });
  });

  describe('+ menu', () => {
    it('opens under the + with the valid child types and relays the choice', async () => {
      const wrapper = mountNode(node('assumption-1', 'solution-1'), { canAdd: true, addMenuOpen: true });
      expect(wrapper.get('[data-cy="ost-node-add-assumption-1"]').attributes('aria-expanded')).toBe('true');
      const menu = wrapper.get('[data-cy="ost-add-menu"]');
      expect(menu.findAll('[role="menuitem"]').map(i => i.text())).toEqual(['Evidence']);
      await menu.get('[data-cy="ost-add-menu-evidence"]').trigger('click');
      expect(wrapper.emitted('addChoose')).toEqual([['evidence']]);
      expect(wrapper.emitted('activate')).toBeUndefined();
    });

    it('no menu without canAdd (a type that permits no children)', () => {
      const wrapper = mountNode(node('assumption-1', 'solution-1'), { addMenuOpen: true });
      expect(wrapper.find('[data-cy="ost-add-menu"]').exists()).toBe(false);
    });
  });
});
describe('OstNode with a colour of its own', () => {
  const TYPES: NodeType[] = ['project', 'outcome', 'opportunity', 'solution', 'assumption', 'evidence'];
  const cases = TYPES.flatMap(type => NODE_COLORS.map(color => [type, color] as const));

  it.each(cases)('%s in %s: the colour is an attribute, the type frame and label stay', (type, color) => {
    const wrapper = mountNode(
      node(`${type}-1`, type === 'project' ? null : 'x-1', { color, status: type === 'solution' ? 'shipped' : '' }),
    );
    const root = wrapper.get('.ost-node');
    expect(root.attributes('data-ost-color')).toBe(color);
    expect(root.classes()).toContain(`ost-node--${type}`);
    expect(root.attributes('data-node-type')).toBe(type);
    expect(wrapper.get('.ost-node__kicker').text().toLowerCase()).toBe(type);
    // Size only: no colour value is ever written into the node's style.
    expect(root.attributes('style')).toMatch(/^width: \d+px; min-height: \d+px;$/);
  });

  it('a node without a colour carries no attribute', () => {
    for (const color of [null, undefined]) {
      expect(
        mountNode(node('solution-1', 'x-1', { color }))
          .get('.ost-node')
          .attributes('data-ost-color'),
      ).toBeUndefined();
    }
  });

  it.each(['red; background:url(https://example.com)', '#ff0000', 'RED', '', 7, { a: 1 }])(
    'a value that is not a colour of the palette (%j) never reaches the element',
    hostile => {
      const wrapper = mountNode(node('solution-1', 'x-1', { color: hostile as never }));
      expect(wrapper.get('.ost-node').attributes('data-ost-color')).toBeUndefined();
      expect(wrapper.html()).not.toContain('example.com');
      expect(wrapper.html()).not.toContain('background');
    },
  );

  it('keeps every state class on a coloured node', () => {
    const wrapper = mountNode(node('opportunity-1', 'x-1', { color: 'teal', status: 'exploring' }), {
      selected: true,
      match: true,
      dimmed: true,
      legalTarget: true,
      dropTarget: true,
    });
    const root = wrapper.get('.ost-node');
    expect(root.classes()).toEqual(expect.arrayContaining(['is-selected', 'is-match', 'is-dimmed', 'is-target', 'is-drop']));
    expect(root.attributes('data-ost-color')).toBe('teal');
    expect(root.attributes('aria-label')).toBe('Opportunity: Title opportunity-1, exploring, selected');
  });

  it('follows a change of colour', async () => {
    const wrapper = mountNode(node('evidence-1', 'x-1', { color: 'red' }));
    await wrapper.setProps({ node: node('evidence-1', 'x-1', { color: 'blue' }) });
    expect(wrapper.get('.ost-node').attributes('data-ost-color')).toBe('blue');
    await wrapper.setProps({ node: node('evidence-1', 'x-1') });
    expect(wrapper.get('.ost-node').attributes('data-ost-color')).toBeUndefined();
  });

  it('the colour rules come before the state rules, so every state still shows on a colour', () => {
    const css = readFileSync('src/ost/canvas/OstNode.vue', 'utf8');
    const at = (text: string) => {
      const i = css.indexOf(text);
      expect(i, text).toBeGreaterThan(-1);
      return i;
    };
    const colour = at('.ost-node[data-ost-color] {');
    expect(colour).toBeGreaterThan(at('.ost-node--evidence {'));
    for (const state of [
      '.ost-node.is-match {',
      '.ost-node.is-target {',
      '.ost-node.is-selected {',
      '.ost-node.is-drop {',
      '.ost-node.is-dimmed {',
    ]) {
      expect(at(state), state).toBeGreaterThan(colour);
    }
    // Selected keeps the colour; the drop target under the pointer takes the accent fill, last.
    expect(at('.ost-node.is-drop {')).toBeGreaterThan(at('.ost-node[data-ost-color].is-selected {'));
    // The border style is the type's: the colour rule sets a colour, never a style or the shorthand.
    const rule = css.slice(colour, css.indexOf('}', colour));
    expect(rule).toContain('border-color: var(--node-edge);');
    expect(rule).not.toMatch(/border(-style)?:/);
  });
});
