import { beforeEach, describe, expect, it } from 'vitest';

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import CanvasToolbar from './CanvasToolbar.vue';

/** Live-region semantics on the element or any ancestor. */
function liveAncestor(el: Element | null): string | null {
  for (let at = el; at; at = at.parentElement) {
    const live = at.getAttribute('aria-live');
    const role = at.getAttribute('role');
    if ((live && live !== 'off') || ['status', 'alert', 'log', 'timer', 'marquee'].includes(role ?? '')) {
      return at.outerHTML.slice(0, 80);
    }
  }
  return null;
}

describe('CanvasToolbar', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const mountToolbar = (zoom = 0.82) => mount(CanvasToolbar, { props: { zoom }, attachTo: document.body });

  it('shows the zoom level, which is not a live region (every wheel notch would be announced)', () => {
    const w = mountToolbar();
    const level = w.get('[data-cy="ost-zoom-level"]');
    expect(level.text()).toBe('82%');
    expect(liveAncestor(level.element)).toBeNull();
    w.unmount();
  });

  it('"+ Project" asks for a new project', async () => {
    const w = mountToolbar();
    await w.get('[data-cy="ost-add-project"]').trigger('click');
    expect(w.emitted('addProject')).toHaveLength(1);
    w.unmount();
  });

  describe('undo and redo', () => {
    it('are disabled, and say so, when there is nothing to undo or redo', () => {
      const w = mountToolbar();
      const undo = w.get('[data-cy="ost-undo"]');
      const redo = w.get('[data-cy="ost-redo"]');
      expect(undo.attributes('disabled')).toBeDefined();
      expect(redo.attributes('disabled')).toBeDefined();
      expect(undo.attributes('aria-label')).toBe('Nothing to undo');
      expect(redo.attributes('aria-label')).toBe('Nothing to redo');
      expect(undo.attributes('title')).toMatch(/^Nothing to undo \((Ctrl\+Z|⌘Z)\)$/);
      w.unmount();
    });

    it('name the step they would undo / redo, with the shortcut in the tooltip, and ask the page to do it', async () => {
      const w = mount(CanvasToolbar, {
        props: { zoom: 1, undoLabel: 'delete “Weekly planner”', redoLabel: null },
        attachTo: document.body,
      });
      const undo = w.get('[data-cy="ost-undo"]');
      const redo = w.get('[data-cy="ost-redo"]');
      expect(undo.attributes('disabled')).toBeUndefined();
      expect(redo.attributes('disabled')).toBeDefined();
      expect(undo.attributes('aria-label')).toBe('Undo delete “Weekly planner”');
      expect(undo.attributes('title')).toMatch(/^Undo delete “Weekly planner” \((Ctrl\+Z|⌘Z)\)$/);
      await undo.trigger('click');
      expect(w.emitted('undo')).toHaveLength(1);

      await w.setProps({ undoLabel: null, redoLabel: 'delete “Weekly planner”' });
      expect(undo.attributes('disabled')).toBeDefined();
      expect(redo.attributes('disabled')).toBeUndefined();
      expect(redo.attributes('aria-label')).toBe('Redo delete “Weekly planner”');
      expect(redo.attributes('title')).toMatch(/^Redo delete “Weekly planner” \((Ctrl\+Y|⇧⌘Z)\)$/);
      await redo.trigger('click');
      expect(w.emitted('redo')).toHaveLength(1);
      w.unmount();
    });

    it('are buttons of the app (44px on a touch screen) in a named group, with the icon hidden from assistive tech', () => {
      const w = mountToolbar();
      const group = w.get('[role="group"][aria-label="Undo and redo"]');
      const buttons = group.findAll('button');
      expect(buttons.map(b => b.attributes('data-cy'))).toEqual(['ost-undo', 'ost-redo']);
      for (const b of buttons) {
        expect(b.classes()).toContain('ost-btn');
        expect(b.attributes('type')).toBe('button');
        expect(b.find('svg').attributes('aria-hidden')).toBe('true');
      }
      w.unmount();
    });
  });

  it('counts on the type chips describe the project on the canvas, not the whole tree', async () => {
    // The chips dim what is laid out, so their numbers have to agree with what is on screen.
    // Counting every node in the tree would leave a canvas scoped to one project reporting the
    // other projects' nodes too.
    const { setupStores } = await import('../panel/panel.test-util');
    const { dto } = await import('../domain/fixtures.test-util');
    const ctx = await setupStores([
      dto('project-1', null),
      dto('outcome-1', 'project-1'),
      dto('opportunity-1', 'outcome-1'),
      dto('opportunity-2', 'outcome-1'),
      dto('project-2', null, { sortOrder: 1 }),
      dto('outcome-2', 'project-2'),
      dto('opportunity-3', 'outcome-2'),
    ]);
    const w = mount(CanvasToolbar, { props: { zoom: 1 }, attachTo: document.body, global: { plugins: [ctx.pinia] } });
    const count = (type: string) => w.get(`[data-cy="ost-filter-${type}"]`).text();

    expect(count('opportunity')).toContain('3');
    ctx.ui.setProject('project-2');
    await w.vm.$nextTick();
    expect(count('opportunity')).toContain('1');
    expect(count('outcome')).toContain('1');
    ctx.ui.setProject('all');
    await w.vm.$nextTick();
    expect(count('opportunity')).toContain('3');
    w.unmount();
  });

  describe('the project picker with nested projects', () => {
    // App > (outcome-1 > opportunity-1, Planner > (outcome-2 > (opportunity-2, opportunity-3), Favourites > outcome-3), Shopping); Other > outcome-4
    async function nestedToolbar() {
      const { setupStores } = await import('../panel/panel.test-util');
      const { dto } = await import('../domain/fixtures.test-util');
      const ctx = await setupStores([
        dto('project-1', null, { title: 'App' }),
        dto('outcome-1', 'project-1', { title: 'App outcome' }),
        dto('opportunity-1', 'outcome-1', { title: 'Find me at the top' }),
        dto('project-2', 'project-1', { title: 'Planner' }),
        dto('outcome-2', 'project-2', { title: 'Planner outcome' }),
        dto('opportunity-2', 'outcome-2', { title: 'Find me in the planner' }),
        dto('opportunity-3', 'outcome-2', { title: 'Another one', sortOrder: 1 }),
        dto('project-3', 'project-2', { title: 'Favourites' }),
        dto('outcome-3', 'project-3', { title: 'Find me in favourites' }),
        dto('project-4', 'project-1', { title: 'Shopping', sortOrder: 1 }),
        dto('project-5', null, { title: 'Other', sortOrder: 1 }),
        dto('outcome-4', 'project-5', { title: 'Find me elsewhere' }),
      ]);
      const w = mount(CanvasToolbar, { props: { zoom: 1 }, attachTo: document.body, global: { plugins: [ctx.pinia] } });
      const open = () => w.get('[data-cy="ost-project-combo"]').trigger('click');
      const rows = () =>
        w.findAll('[data-cy^="ost-project-option-project-"]').map(row => ({
          id: row.attributes('data-cy')!.replace('ost-project-option-', ''),
          depth: Number(row.attributes('data-depth')),
          indent: (row.element as HTMLElement).style.paddingLeft,
          name: row.get('.ost-project-combo__name').text(),
          sub: row.get('.ost-project-combo__sub').text(),
          on: row.attributes('aria-selected') === 'true',
        }));
      return { ...ctx, w, open, rows };
    }

    it('lists every project in tree order, indented by how deep it is nested', async () => {
      const { w, open, rows } = await nestedToolbar();
      expect(w.get('[data-cy="ost-project-combo-label"]').text()).toBe('All projects');
      expect(w.get('[data-cy="ost-project-combo"]').text()).toContain('5 projects');
      await open();
      expect(rows().map(r => [r.name, r.depth, r.indent])).toEqual([
        ['App', 0, '9px'],
        ['Planner', 1, '25px'],
        ['Favourites', 2, '41px'],
        ['Shopping', 1, '25px'],
        ['Other', 0, '9px'],
      ]);
      // Each row counts what is inside that project; a nested one says that it is nested.
      expect(rows().map(r => r.sub)).toEqual([
        '9 nodes',
        'Sub-project · 5 nodes',
        'Sub-project · 1 node',
        'Sub-project · 0 nodes',
        '1 node',
      ]);
      expect(w.get('[data-cy="ost-project-option-all"]').attributes('aria-selected')).toBe('true');
      w.unmount();
    });

    it('choosing a project, nested or not, asks the page to focus it; the button then names it', async () => {
      const { w, ui, open, rows } = await nestedToolbar();
      await open();
      await w.get('[data-cy="ost-project-option-project-3"]').trigger('click');
      expect(w.emitted('project')).toEqual([['project-3']]);
      expect(w.find('[data-cy="ost-project-option-all"]').exists()).toBe(false);

      ui.setProject('project-3'); // what the page does with the event
      await w.vm.$nextTick();
      expect(w.get('[data-cy="ost-project-combo-label"]').text()).toBe('Favourites');
      expect(w.get('[data-cy="ost-project-combo"]').text()).toContain('1 node');
      await open();
      expect(
        rows()
          .filter(r => r.on)
          .map(r => r.name),
      ).toEqual(['Favourites']);
      await w.get('[data-cy="ost-project-option-all"]').trigger('click');
      expect(w.emitted('project')!.at(-1)).toEqual(['all']);
      w.unmount();
    });

    it('the type counts, the search jump and collapse / expand all follow the focused subtree', async () => {
      const { w, ui, tree } = await nestedToolbar();
      const count = (type: string) => w.get(`[data-cy="ost-filter-${type}"] .ost-toolbar__chip-count`).text();
      const search = w.get('[data-cy="ost-search"]');
      const jumps = async () => {
        const seen: string[] = [];
        await search.setValue('find me');
        for (let i = 0; i < 6; i++) {
          await search.trigger('keydown', { key: 'Enter' });
          const key = w.emitted('jump')?.at(-1)?.[0] as string | undefined;
          if (!key || seen.includes(key)) break;
          seen.push(key);
        }
        await search.setValue('');
        return seen;
      };

      expect([count('outcome'), count('opportunity')]).toEqual(['4', '3']);
      expect(await jumps()).toEqual(['opportunity-1', 'opportunity-2', 'outcome-3', 'outcome-4']);

      // Planner: its own outcome and opportunities, and the sub-project inside it.
      ui.setProject('project-2');
      await w.vm.$nextTick();
      expect([count('outcome'), count('opportunity')]).toEqual(['2', '2']);
      expect(await jumps()).toEqual(['opportunity-2', 'outcome-3']);

      await w.get('[data-cy="ost-collapse-all"]').trigger('click');
      expect(Object.keys(ui.collapsed).sort()).toEqual(['outcome-2', 'project-2', 'project-3']);
      expect(Object.keys(tree.placed)).toEqual(['project-2']);
      expect(w.emitted('fit')).toHaveLength(1);
      ui.setCollapsed('project-1', true); // outside the focus: Expand all leaves it alone
      await w.get('[data-cy="ost-expand-all"]').trigger('click');
      expect(ui.collapsed).toEqual({ 'project-1': true });
      ui.setCollapsed('project-1', false);

      // Favourites, two levels down.
      ui.setProject('project-3');
      await w.vm.$nextTick();
      expect([count('outcome'), count('opportunity')]).toEqual(['1', '0']);
      expect(await jumps()).toEqual(['outcome-3']);
      expect(w.get('[data-cy="ost-collapse-all"]').attributes('disabled')).toBeUndefined();

      // A sub-project with nothing in it has nothing to collapse.
      ui.setProject('project-4');
      await w.vm.$nextTick();
      expect([count('outcome'), count('opportunity')]).toEqual(['0', '0']);
      expect(w.get('[data-cy="ost-collapse-all"]').attributes('disabled')).toBeDefined();

      ui.setProject('all');
      await w.vm.$nextTick();
      expect([count('outcome'), count('opportunity')]).toEqual(['4', '3']);
      w.unmount();
    });
  });

  it('the project combo carets and check use the Phosphor regular weight', async () => {
    const w = mountToolbar();
    const caret = w.get('[data-cy="ost-project-combo"] svg path').attributes('d') ?? '';
    expect(caret).toMatch(/a8,8/); // regular: 8-unit arcs (bold: 12)
    await w.get('[data-cy="ost-project-combo"]').trigger('click');
    const check = w.get('[data-cy="ost-project-option-all"] svg path').attributes('d') ?? '';
    expect(check).toMatch(/a8,8/);
    w.unmount();
  });
});

describe('CanvasToolbar keyboard jump to a node', () => {
  it('Enter / Shift+Enter in the search box step through the matches (types shown, in scope) and announce them', async () => {
    const { setupStores } = await import('../panel/panel.test-util');
    const ctx = await setupStores();
    const w = mount(CanvasToolbar, { props: { zoom: 1 }, attachTo: document.body, global: { plugins: [ctx.pinia] } });
    const search = w.get('[data-cy="ost-search"]');
    await search.setValue('in');
    expect(search.attributes('aria-describedby')).toBeTruthy();

    await search.trigger('keydown', { key: 'Enter' });
    await search.trigger('keydown', { key: 'Enter' });
    await search.trigger('keydown', { key: 'Enter' });
    await search.trigger('keydown', { key: 'Enter', shiftKey: true });
    const order = ['outcome-1', 'opportunity-1', 'solution-1'];
    expect(w.emitted('jump')).toEqual([[order[0]], [order[1]], [order[2]], [order[1]]]);
    expect(w.get('[data-cy="ost-search-status"]').text()).toBe('Match 2 of 3: Hard to find people');

    // Hidden types are skipped; a new query starts over.
    ctx.ui.toggleType('outcome');
    await search.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('jump')!.at(-1)).toEqual(['opportunity-1']);

    await search.setValue('nothing like this');
    await search.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('jump')).toHaveLength(5);
    expect(w.get('[data-cy="ost-search-status"]').text()).toBe('No matching nodes on the canvas');
    w.unmount();
  });

  it('Enter continues from a match the user selected on the canvas since the last jump', async () => {
    const { setupStores } = await import('../panel/panel.test-util');
    const ctx = await setupStores();
    const w = mount(CanvasToolbar, { props: { zoom: 1 }, attachTo: document.body, global: { plugins: [ctx.pinia] } });
    const search = w.get('[data-cy="ost-search"]');
    await search.setValue('in');
    await search.trigger('keydown', { key: 'Enter' }); // match 1: outcome-1
    ctx.ui.select('solution-1'); // the user clicks match 3
    await search.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('jump')!.at(-1)).toEqual(['outcome-1']); // after match 3 comes match 1 (wraps), not match 2
    expect(w.get('[data-cy="ost-search-status"]').text()).toBe('Match 1 of 3: ' + ctx.tree.byId('outcome-1')!.title);
    ctx.ui.select('project-1'); // not a match: continue from the last jump
    await search.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('jump')!.at(-1)).toEqual(['opportunity-1']);
    w.unmount();
  });

  it('the Enter that ends an IME composition does not jump', async () => {
    const { setupStores } = await import('../panel/panel.test-util');
    const ctx = await setupStores();
    const w = mount(CanvasToolbar, { props: { zoom: 1 }, attachTo: document.body, global: { plugins: [ctx.pinia] } });
    const search = w.get('[data-cy="ost-search"]');
    await search.setValue('in');
    const composing = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, cancelable: true });
    search.element.dispatchEvent(composing);
    expect(w.emitted('jump')).toBeUndefined();
    expect(composing.defaultPrevented).toBe(false);
    await search.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('jump')).toEqual([['outcome-1']]);
    w.unmount();
  });

  it('the jump hint describes the search box but is not part of its name', () => {
    setActivePinia(createPinia());
    const w = mount(CanvasToolbar, { props: { zoom: 1 }, attachTo: document.body });
    const search = w.get('[data-cy="ost-search"]');
    const hint = document.getElementById(search.attributes('aria-describedby')!);
    expect(hint?.textContent).toContain('Enter selects the next match');
    expect(search.element.closest('label')!.contains(hint)).toBe(false);
    expect(search.element.closest('label')!.textContent!.trim()).toBe('Search nodes');
    w.unmount();
  });
});
