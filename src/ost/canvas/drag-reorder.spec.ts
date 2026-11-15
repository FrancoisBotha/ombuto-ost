import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AutosaveRecord } from '@/doc/autosave';
import { MAX_DEPTH, parseDocument, serializeDocument } from '@/doc/document';
import * as files from '@/doc/file-access';
import { smallDocument } from '@/doc/small-document.test-util';

import { node } from '../domain/fixtures.test-util';
import { GAP_X, ROW_PITCH, layoutTree } from '../domain/layout';
import { TYPE_BOX } from '../domain/rules';
import type { OstNode } from '../domain/types';
import { setupShellStores } from '../shell/shell.test-util';

import { LEVEL_TOLERANCE, type SiblingRow, dropRows, gapDrop, reorderDrop } from './drag-reorder';

/** The dragged node's own row: its same-type siblings. Null when it has none on the canvas. */
const siblingRow = (key: string, nodes: readonly OstNode[], placed: ReturnType<typeof layoutTree>, all = true): SiblingRow | null =>
  dropRows(key, nodes, placed, all).find(row => row.index >= 0) ?? null;

vi.mock(import('@/doc/file-access'), async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, supportsFileHandles: vi.fn(() => false), pickFileToOpen: vi.fn(), pickFileToSave: vi.fn(), downloadFile: vi.fn() };
});

afterEach(() => {
  vi.clearAllMocks();
});

const W = TYPE_BOX.project.w;

/** Lays the nodes out as the canvas does: every top-level project, or only `focus`. */
const lay = (nodes: OstNode[], focus?: string) =>
  layoutTree(nodes, { roots: focus ? [focus] : nodes.filter(n => n.parent === null).map(n => n.id), collapsed: {} });

/** Four top-level projects, the second with children so the gaps between siblings differ. */
function topLevel(): OstNode[] {
  return [
    node('project-1', null, { sortOrder: 0 }),
    node('project-2', null, { sortOrder: 1 }),
    node('outcome-1', 'project-2', { sortOrder: 0 }),
    node('outcome-2', 'project-2', { sortOrder: 1 }),
    node('project-3', null, { sortOrder: 2 }),
    node('project-4', null, { sortOrder: 3 }),
  ];
}

/** A project holding two outcomes and three sub-projects (outcomes come first), next to another project. */
function nested(): OstNode[] {
  return [
    node('project-1', null, { sortOrder: 0 }),
    node('outcome-1', 'project-1', { sortOrder: 0 }),
    node('outcome-2', 'project-1', { sortOrder: 1 }),
    node('project-11', 'project-1', { sortOrder: 0 }),
    node('project-12', 'project-1', { sortOrder: 1 }),
    node('project-13', 'project-1', { sortOrder: 2 }),
    node('project-2', null, { sortOrder: 1 }),
  ];
}

describe('dropRows: the dragged node among its own siblings', () => {
  it('gives the other same-type siblings in order, and where the dragged node is among them', () => {
    const nodes = topLevel();
    const placed = lay(nodes);
    const row = siblingRow('project-3', nodes, placed)!;
    expect(row.others.map(o => o.id)).toEqual(['project-1', 'project-2', 'project-4']);
    expect(row.index).toBe(2);
    expect(row.others.map(o => o.x)).toEqual(['project-1', 'project-2', 'project-4'].map(k => placed[k].x));
    expect(row).toMatchObject({ y: 0, h: TYPE_BOX.project.h });
    expect(siblingRow('project-1', nodes, placed)!.index).toBe(0);
    expect(siblingRow('project-4', nodes, placed)!.index).toBe(3);
  });

  it('orders by sortOrder then id, whatever order the list is in', () => {
    const nodes = topLevel().reverse();
    const row = siblingRow('project-2', nodes, lay(topLevel()))!;
    expect(row.others.map(o => o.id)).toEqual(['project-1', 'project-3', 'project-4']);
    expect(row.index).toBe(1);
  });

  it('a sub-project only has the other sub-projects as siblings, never the outcomes beside it', () => {
    const nodes = nested();
    const row = siblingRow('project-12', nodes, lay(nodes))!;
    expect(row.others.map(o => o.id)).toEqual(['project-11', 'project-13']);
    expect(row.index).toBe(1);
    expect(row.y).toBe(ROW_PITCH);
    expect(siblingRow('outcome-2', nodes, lay(nodes))!.others.map(o => o.id)).toEqual(['outcome-1']);
  });

  it('is null with no sibling, for an unknown node, and for a node that is not laid out', () => {
    const nodes = nested();
    const placed = lay(nodes);
    expect(
      siblingRow(
        'outcome-1',
        nodes.filter(n => n.id !== 'outcome-2'),
        placed,
      ),
    ).toBeNull();
    expect(siblingRow('project-99', nodes, placed)).toBeNull();
    expect(siblingRow('project-11', nodes, {})).toBeNull();
  });

  it('with the picker focused on one project that project has nothing to reorder, and its sub-projects still do', () => {
    const nodes = nested();
    const focused = lay(nodes, 'project-1');
    expect(focused['project-2']).toBeUndefined();
    expect(siblingRow('project-1', nodes, focused)).toBeNull();
    expect(siblingRow('project-13', nodes, focused)!.others.map(o => o.id)).toEqual(['project-11', 'project-12']);

    // Focused on a sub-project: its sibling sub-projects are not on the canvas either.
    const deep = lay(nodes, 'project-12');
    expect(deep['project-12']).toBeDefined();
    expect(siblingRow('project-12', nodes, deep)).toBeNull();
  });
});

describe('reorderDrop', () => {
  const nodes = topLevel();
  const placed = lay(nodes);
  const x = (key: string) => placed[key].x;
  const row = (key: string) => siblingRow(key, nodes, placed)!;

  it('does nothing where the node already is, or anywhere short of a sibling centre', () => {
    expect(reorderDrop(row('project-3'), x('project-3'), 0)).toBeNull();
    expect(reorderDrop(row('project-3'), x('project-2') + 1, 0)).toBeNull();
    expect(reorderDrop(row('project-3'), x('project-4') - 1, 0)).toBeNull();
    expect(reorderDrop(row('project-1'), x('project-1') - 5000, 0)).toBeNull(); // already first
    expect(reorderDrop(row('project-4'), x('project-4') + 5000, 0)).toBeNull(); // already last
  });

  it('moves one place left or right once the centre passes the neighbour centre', () => {
    expect(reorderDrop(row('project-3'), x('project-2') - 1, 0)?.position).toBe(1);
    expect(reorderDrop(row('project-3'), x('project-4') + 1, 0)?.position).toBe(3);
    expect(reorderDrop(row('project-1'), x('project-2') + 1, 0)?.position).toBe(1);
  });

  it('moves across several siblings, to either end', () => {
    expect(reorderDrop(row('project-4'), x('project-1') - 1, 0)?.position).toBe(0);
    expect(reorderDrop(row('project-4'), x('project-2') - 1, 0)?.position).toBe(1);
    expect(reorderDrop(row('project-1'), x('project-4') + 1, 0)?.position).toBe(3);
    expect(reorderDrop(row('project-1'), x('project-3') + 1, 0)?.position).toBe(2);
  });

  it('puts the marker in the middle of the gap the node lands in, or just outside the end sibling', () => {
    // Between project-1 and project-2 (project-2 sits centred over its two outcomes).
    const between = reorderDrop(row('project-4'), x('project-2') - 1, 0)!;
    expect(between.x).toBe((x('project-1') + W / 2 + (x('project-2') - W / 2)) / 2);
    expect(between.x).toBeGreaterThan(x('project-1') + W / 2);
    expect(between.x).toBeLessThan(x('project-2') - W / 2);
    expect(reorderDrop(row('project-4'), x('project-1') - 1, 0)!.x).toBe(x('project-1') - W / 2 - GAP_X / 2);
    expect(reorderDrop(row('project-1'), x('project-4') + 1, 0)!.x).toBe(x('project-4') + W / 2 + GAP_X / 2);
  });

  it('only counts level with the siblings: half a row up or down, no further', () => {
    const past = x('project-1') - 1;
    expect(reorderDrop(row('project-4'), past, LEVEL_TOLERANCE)?.position).toBe(0);
    expect(reorderDrop(row('project-4'), past, -LEVEL_TOLERANCE)?.position).toBe(0);
    expect(reorderDrop(row('project-4'), past, LEVEL_TOLERANCE + 1)).toBeNull();
    expect(reorderDrop(row('project-4'), past, -ROW_PITCH)).toBeNull();
    expect(reorderDrop(row('project-4'), Number.NaN, 0)).toBeNull();
  });

  it('a sub-project dragged left of the outcomes becomes the first sub-project, not an outcome neighbour', () => {
    const mixed = nested();
    const at = lay(mixed);
    const last = siblingRow('project-13', mixed, at)!;
    expect(reorderDrop(last, at['outcome-1'].x - 1, 0)?.position).toBe(0);
    // The first sub-project dragged over the outcomes is still first: nothing changes.
    expect(reorderDrop(siblingRow('project-11', mixed, at)!, at['outcome-1'].x - 1, 0)).toBeNull();
    // An outcome dragged right past every sub-project is still the last outcome.
    expect(reorderDrop(siblingRow('outcome-2', mixed, at)!, at['project-13'].x + 1, 0)).toBeNull();
    expect(reorderDrop(siblingRow('outcome-2', mixed, at)!, at['outcome-1'].x - 1, 0)?.position).toBe(0);
  });
});

describe('dropRows: every row the dragged node can be dropped into', () => {
  /** project-1 > (outcome-1, project-11 > project-111, project-12, project-13); project-2 > (project-21, project-22); project-3. */
  function forest(): OstNode[] {
    return [
      node('project-1', null, { sortOrder: 0 }),
      node('outcome-1', 'project-1'),
      node('project-11', 'project-1', { sortOrder: 0 }),
      node('project-111', 'project-11'),
      node('project-12', 'project-1', { sortOrder: 1 }),
      node('project-13', 'project-1', { sortOrder: 2 }),
      node('project-2', null, { sortOrder: 1 }),
      node('project-21', 'project-2', { sortOrder: 0 }),
      node('project-22', 'project-2', { sortOrder: 1 }),
      node('project-3', null, { sortOrder: 2 }),
    ];
  }
  const parents = (rows: SiblingRow[]) => rows.map(r => r.parent).sort();
  const rowOf = (rows: SiblingRow[], parent: string | null) => rows.find(r => r.parent === parent)!;

  it('a sub-project: its own siblings, the sub-projects of every other project, and the top-level projects', () => {
    const nodes = forest();
    const placed = lay(nodes);
    const rows = dropRows('project-12', nodes, placed, true);
    expect(parents(rows)).toEqual([null, 'project-1', 'project-11', 'project-2'].sort());
    expect(rowOf(rows, 'project-1')).toMatchObject({ index: 1, y: ROW_PITCH });
    expect(rowOf(rows, 'project-1').others.map(o => o.id)).toEqual(['project-11', 'project-13']);
    expect(rowOf(rows, 'project-1').reach).toBeUndefined();
    // The top-level row: not the node's own, at the top, and with its level to itself.
    expect(rowOf(rows, null)).toMatchObject({ index: -1, y: 0, h: TYPE_BOX.project.h });
    expect(rowOf(rows, null).others.map(o => o.id)).toEqual(['project-1', 'project-2', 'project-3']);
    expect(rowOf(rows, null).reach).toBeUndefined();
    // Another project's sub-projects: only close to the row counts.
    expect(rowOf(rows, 'project-2')).toMatchObject({ index: -1, y: ROW_PITCH, reach: GAP_X + W });
    expect(rowOf(rows, 'project-11')).toMatchObject({ index: -1, y: 2 * ROW_PITCH });
  });

  it('never offers a row inside the dragged node: a project cannot end up under itself', () => {
    const nodes = forest();
    const placed = lay(nodes);
    expect(parents(dropRows('project-1', nodes, placed, true))).toEqual([null, 'project-2'].sort());
    expect(parents(dropRows('project-11', nodes, placed, true))).toEqual([null, 'project-1', 'project-2'].sort());
  });

  it('offers no top-level row while the picker shows a single project: that row is not on screen', () => {
    const nodes = forest();
    // Focused on project-1: the other top-level projects are not laid out.
    const focused = lay(nodes, 'project-1');
    expect(parents(dropRows('project-12', nodes, focused, false))).toEqual(['project-1', 'project-11'].sort());
    // Even a tree with one top-level project gets no top row unless every project is shown.
    const single = nodes.filter(n => !['project-2', 'project-21', 'project-22', 'project-3'].includes(n.id));
    expect(parents(dropRows('project-12', single, lay(single, 'project-1'), false))).toEqual(['project-1', 'project-11'].sort());
    expect(parents(dropRows('project-12', single, lay(single), true))).toEqual([null, 'project-1', 'project-11'].sort());
  });

  it('skips a row that is not laid out (its parent is collapsed)', () => {
    const nodes = forest();
    const placed = layoutTree(nodes, { roots: ['project-1', 'project-2', 'project-3'], collapsed: { 'project-2': true } });
    expect(parents(dropRows('project-12', nodes, placed, true))).toEqual([null, 'project-1', 'project-11'].sort());
  });

  it('works for every type: an opportunity can go among the opportunities of another outcome, never among solutions', () => {
    const nodes = [
      node('project-1', null),
      node('outcome-1', 'project-1', { sortOrder: 0 }),
      node('opportunity-1', 'outcome-1', { sortOrder: 0 }),
      node('opportunity-2', 'outcome-1', { sortOrder: 1 }),
      node('solution-1', 'opportunity-2'),
      node('outcome-2', 'project-1', { sortOrder: 1 }),
      node('opportunity-3', 'outcome-2', { sortOrder: 0 }),
      node('opportunity-4', 'outcome-2', { sortOrder: 1 }),
    ];
    const rows = dropRows('opportunity-1', nodes, lay(nodes), true);
    expect(parents(rows)).toEqual(['outcome-1', 'outcome-2']);
    expect(rowOf(rows, 'outcome-2').others.map(o => o.id)).toEqual(['opportunity-3', 'opportunity-4']);
    // An outcome has nowhere but its own row (the other project has no outcomes to sit between).
    expect(parents(dropRows('outcome-1', nodes, lay(nodes), true))).toEqual(['project-1']);
  });

  it('is empty for an unknown node and for one that is not laid out', () => {
    const nodes = forest();
    expect(dropRows('project-99', nodes, lay(nodes), true)).toEqual([]);
    expect(dropRows('project-12', nodes, {}, true)).toEqual([]);
  });

  describe('gapDrop: the gap a drop lands in', () => {
    const nodes = forest();
    const placed = lay(nodes);
    const x = (key: string) => placed[key].x;
    const sub = dropRows('project-12', nodes, placed, true);

    it('a sub-project dropped level with the top-level projects becomes one, where its centre is', () => {
      expect(gapDrop(sub, x('project-1') - 400, 0)).toMatchObject({ parent: null, position: 0 });
      expect(gapDrop(sub, x('project-1') + 1, 0)).toMatchObject({ parent: null, position: 1 });
      expect(gapDrop(sub, x('project-2') + 1, 0)).toMatchObject({ parent: null, position: 2 });
      expect(gapDrop(sub, x('project-3') + 9000, 0)).toMatchObject({ parent: null, position: 3 });
      // Half a row of tolerance, like a re-order.
      expect(gapDrop(sub, x('project-2') + 1, LEVEL_TOLERANCE)).toMatchObject({ parent: null, position: 2 });
      expect(gapDrop(sub, x('project-2') + 1, -LEVEL_TOLERANCE)).toMatchObject({ parent: null, position: 2 });
    });

    it('the marker is in the gap it will land in, on the row it will land in', () => {
      const drop = gapDrop(sub, x('project-1') + 1, 0)!;
      expect(drop.x).toBe((x('project-1') + W / 2 + (x('project-2') - W / 2)) / 2);
      expect(drop.row).toMatchObject({ y: 0, h: TYPE_BOX.project.h });
      expect(gapDrop(sub, x('project-1') - 400, 0)!.x).toBe(x('project-1') - W / 2 - GAP_X / 2);
    });

    it('level with its own siblings it re-orders, and where nothing changes it is no drop', () => {
      expect(gapDrop(sub, x('project-12'), ROW_PITCH)).toBeNull();
      expect(gapDrop(sub, x('project-11') - 1, ROW_PITCH)).toMatchObject({ parent: 'project-1', position: 0 });
      expect(gapDrop(sub, x('project-13') + 1, ROW_PITCH)).toMatchObject({ parent: 'project-1', position: 2 });
    });

    it('in a gap of another project it becomes a sub-project of that project, at that place', () => {
      expect(gapDrop(sub, x('project-21') + 1, ROW_PITCH)).toMatchObject({ parent: 'project-2', position: 1 });
      expect(gapDrop(sub, x('project-22') + 1, ROW_PITCH)).toMatchObject({ parent: 'project-2', position: 2 });
      expect(gapDrop(sub, x('project-111') + 1, 2 * ROW_PITCH)).toMatchObject({ parent: 'project-11', position: 1 });
      // A top-level project into the gap between two sub-projects.
      const top = dropRows('project-3', nodes, placed, true);
      expect(gapDrop(top, x('project-12') + 1, ROW_PITCH)).toMatchObject({ parent: 'project-1', position: 2 });
    });

    it('between two rows the nearer end wins; its own row wins a tie and takes whatever is beyond reach', () => {
      const end = x('project-13') + W / 2; // right end of its own row
      const start = x('project-21') - W / 2; // left end of the next project's row
      expect(gapDrop(sub, end + 1, ROW_PITCH)).toMatchObject({ parent: 'project-1' });
      expect(gapDrop(sub, start - 1, ROW_PITCH)).toMatchObject({ parent: 'project-2', position: 0 });
      // Far right of everything: beyond the reach of project-2's row, so it is its own row's end.
      expect(gapDrop(sub, x('project-22') + W / 2 + GAP_X + W + 1, ROW_PITCH)).toMatchObject({ parent: 'project-1', position: 2 });
      expect(gapDrop(sub, x('project-22') + W / 2 + GAP_X + W - 1, ROW_PITCH)).toMatchObject({ parent: 'project-2', position: 2 });
    });

    it('a row of another parent is only reached close to it; level with no row there is no drop', () => {
      const top = dropRows('project-3', nodes, placed, true);
      expect(gapDrop(top, x('project-22') + W / 2 + GAP_X + W + 1, ROW_PITCH)).toBeNull();
      expect(gapDrop(top, x('project-11') - W / 2 - GAP_X - W - 1, ROW_PITCH)).toBeNull();
      expect(gapDrop(sub, x('project-1'), 3 * ROW_PITCH)).toBeNull();
      expect(gapDrop(sub, x('project-1'), -ROW_PITCH)).toBeNull();
      expect(gapDrop(sub, Number.NaN, 0)).toBeNull();
      expect(gapDrop([], 0, 0)).toBeNull();
    });
  });
});

describe('a drop in a gap reaches the document', () => {
  const record = (): AutosaveRecord => ({ doc: smallDocument(), dirty: false, fileName: null, handle: null, savedAt: null });
  const OUTCOME = 'More people plan a full week of meals';

  async function setup() {
    const ctx = setupShellStores(record());
    await ctx.doc.init();
    const { tree, ui, doc } = ctx;
    for (const title of ['Second', 'Third']) await tree.createProject(title);
    for (const title of ['Sub A', 'Sub B', 'Sub C']) await tree.createNode('project-1', 'project', title);
    await tree.createNode('project-1', 'outcome', 'Another outcome');
    ui.stopEditing();
    await doc.save(); // a download: the document is clean from here
    expect(doc.dirty).toBe(false);

    const key = (title: string) => tree.nodes.find(n => n.title === title)!.id;
    const x = (title: string) => tree.placed[key(title)].x;
    /** What the canvas does on a drop: decide, and write only when something changes. */
    const drop = async (title: string, centreX: number, dy = 0) => {
      const rows = dropRows(key(title), tree.nodes, tree.placed, ui.projectId === 'all');
      const place = gapDrop(rows, centreX, tree.placed[key(title)].y + dy);
      return place ? tree.moveNode(key(title), place.parent, place.position) : null;
    };
    const top = () => tree.roots.map(n => n.title);
    const subs = () => tree.nodes.filter(n => n.parent === 'project-1' && n.type === 'project').map(n => n.title);
    /** The same, read from the document as it would be written to a file. */
    const stored = (parentId: number | null) =>
      parseDocument(serializeDocument(doc.service.snapshot()!))
        .nodes.filter(n => n.type === 'project' && n.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(n => n.title);
    return { ...ctx, key, x, drop, top, subs, stored };
  }

  it('a sub-project dropped level with the top-level projects becomes one, at the place shown', async () => {
    const { doc, tree, drop, x, top, subs, stored, key } = await setup();
    expect(await drop('Sub B', x('Second') - 1, -ROW_PITCH)).toBe(true);
    expect(top()).toEqual(['Meal-planning app', 'Sub B', 'Second', 'Third']);
    expect(subs()).toEqual(['Sub A', 'Sub C']);
    expect(tree.byId(key('Sub B'))!.parent).toBeNull();
    expect(stored(null)).toEqual(['Meal-planning app', 'Sub B', 'Second', 'Third']);
    expect(stored(1)).toEqual(['Sub A', 'Sub C']);
    expect(doc.dirty).toBe(true);

    // First and last place too.
    expect(await drop('Sub A', x('Meal-planning app') - 2000, -ROW_PITCH)).toBe(true);
    expect(await drop('Sub C', x('Third') + 1, -ROW_PITCH)).toBe(true);
    expect(stored(null)).toEqual(['Sub A', 'Meal-planning app', 'Sub B', 'Second', 'Third', 'Sub C']);
    expect(stored(1)).toEqual([]);

    // One undo per drop puts each of them back where it was.
    for (let i = 0; i < 3; i++) expect(await doc.undo()).toBe(true);
    expect(stored(null)).toEqual(['Meal-planning app', 'Second', 'Third']);
    expect(stored(1)).toEqual(['Sub A', 'Sub B', 'Sub C']);
    expect(doc.dirty).toBe(false);
  });

  it('a project dropped between two sub-projects of another project becomes their sibling', async () => {
    const { drop, x, top, subs, stored } = await setup();
    expect(await drop('Third', x('Sub B') - 1, ROW_PITCH)).toBe(true);
    expect(top()).toEqual(['Meal-planning app', 'Second']);
    expect(subs()).toEqual(['Sub A', 'Third', 'Sub B', 'Sub C']);
    expect(stored(1)).toEqual(['Sub A', 'Third', 'Sub B', 'Sub C']);
  });

  it('a project never lands in a row of its own sub-projects, and a drop level with nothing writes nothing', async () => {
    const { doc, drop, x, top } = await setup();
    expect(await drop('Meal-planning app', x('Sub B') - 1, ROW_PITCH)).toBeNull();
    expect(await drop('Sub B', x('Sub B'), 2 * ROW_PITCH)).toBeNull();
    expect(top()).toEqual(['Meal-planning app', 'Second', 'Third']);
    expect(doc.dirty).toBe(false);
  });

  it('with the picker on one project there is no top row to drop on: the sub-project stays where it is', async () => {
    const { doc, ui, drop, x, subs, stored } = await setup();
    ui.setProject('project-1');
    expect(await drop('Sub B', x('Meal-planning app') + 300, -ROW_PITCH)).toBeNull();
    expect(await drop('Sub B', x('Meal-planning app') - 300, -ROW_PITCH)).toBeNull();
    expect(subs()).toEqual(['Sub A', 'Sub B', 'Sub C']);
    expect(stored(null)).toEqual(['Meal-planning app', 'Second', 'Third']);
    expect(doc.dirty).toBe(false);
  });

  it('the depth limit still applies to a drop in a gap, with its message', async () => {
    const { tree, key, stored } = await setup();
    // A chain of sub-projects under Second, down to the deepest level a tree may have.
    let parent = key('Second');
    for (let level = 2; level <= MAX_DEPTH; level++) parent = (await tree.createNode(parent, 'project', `Level ${level}`))!;
    const sibling = (await tree.createNode(tree.byId(parent)!.parent!, 'project', 'Deep sibling'))!;
    expect(tree.byId(sibling)).toBeDefined();
    // "Meal-planning app" has sub-projects: next to the deepest pair it would pass the limit.
    const row = tree.placed[sibling];
    const rows = dropRows('project-1', tree.nodes, tree.placed, true);
    const place = gapDrop(rows, row.x + 1, row.y)!;
    expect(place.parent).toBe(tree.byId(sibling)!.parent);
    expect(await tree.moveNode('project-1', place.parent, place.position)).toBe(false);
    expect(tree.error).toBe(`A tree can be at most ${MAX_DEPTH} levels deep.`);
    expect(stored(null)).toEqual(['Meal-planning app', 'Second', 'Third']);
  });

  describe('moving out one level (Alt+Up)', () => {
    it('a sub-project lands at the top level, straight after the project it was in', async () => {
      const { doc, tree, key, top, subs, stored } = await setup();
      expect(await tree.outdentNode(key('Sub B'))).toBe(true);
      expect(top()).toEqual(['Meal-planning app', 'Sub B', 'Second', 'Third']);
      expect(subs()).toEqual(['Sub A', 'Sub C']);
      expect(stored(null)).toEqual(['Meal-planning app', 'Sub B', 'Second', 'Third']);
      expect(doc.undoLabel).toBe('move “Sub B”');
    });

    it('a project two levels down moves out one level at a time', async () => {
      const { tree, key, top, subs } = await setup();
      const deep = (await tree.createNode(key('Sub B'), 'project', 'Deep'))!;
      expect(await tree.outdentNode(deep)).toBe(true);
      expect(subs()).toEqual(['Sub A', 'Sub B', 'Deep', 'Sub C']);
      expect(await tree.outdentNode(deep)).toBe(true);
      expect(top()).toEqual(['Meal-planning app', 'Deep', 'Second', 'Third']);
    });

    it('there is no level to move out to for a top-level project, or where the level above cannot hold the node', async () => {
      const { doc, tree } = await setup();
      expect(await tree.outdentNode('project-1')).toBe(false);
      expect(await tree.outdentNode('outcome-2')).toBe(false); // an outcome of a top-level project
      expect(await tree.outdentNode('solution-6')).toBe(false); // an outcome holds no solutions
      expect(await tree.outdentNode('nothing-9')).toBe(false);
      expect(tree.error).toBeNull();
      expect(doc.dirty).toBe(false);
    });

    it('works for the other types that nest: an opportunity moves out from under an opportunity', async () => {
      const { tree } = await setup();
      const opportunities = () => tree.nodes.filter(n => n.parent === 'outcome-2' && n.type === 'opportunity').map(n => n.id);
      expect(tree.byId('opportunity-5')!.parent).toBe('opportunity-3');
      expect(await tree.outdentNode('opportunity-5')).toBe(true);
      expect(opportunities()).toEqual(['opportunity-3', 'opportunity-5', 'opportunity-11', 'opportunity-14']);
    });

    it('a sub-project moved out of the focused project switches the picker to every project', async () => {
      const { tree, ui, key } = await setup();
      ui.setProject('project-1');
      expect(await tree.outdentNode(key('Sub B'))).toBe(true);
      expect(ui.projectId).toBe('all');
    });
  });

  it('a drop that changes nothing writes nothing: the document stays clean', async () => {
    const { doc, drop, x, top } = await setup();
    expect(await drop('Second', x('Second') + 40)).toBeNull();
    expect(await drop('Meal-planning app', x('Meal-planning app') - 900)).toBeNull();
    expect(await drop('Third', x('Meal-planning app') - 1, -ROW_PITCH)).toBeNull(); // level with no row of projects
    expect(top()).toEqual(['Meal-planning app', 'Second', 'Third']);
    expect(doc.dirty).toBe(false);
  });

  it('re-orders top-level projects, and the order is in the snapshot and survives save and open', async () => {
    const { doc, tree, drop, x, top, stored } = await setup();
    expect(await drop('Third', x('Meal-planning app') - 1)).toBe(true);
    expect(top()).toEqual(['Third', 'Meal-planning app', 'Second']);
    expect(doc.dirty).toBe(true);
    expect(stored(null)).toEqual(['Third', 'Meal-planning app', 'Second']);

    expect(await drop('Third', x('Second') + 1)).toBe(true);
    expect(await drop('Meal-planning app', x('Second') + 1)).toBe(true);
    expect(top()).toEqual(['Second', 'Meal-planning app', 'Third']);
    expect(stored(null)).toEqual(['Second', 'Meal-planning app', 'Third']);

    // Save, then open what was saved.
    await doc.save();
    const text = String(vi.mocked(files.downloadFile).mock.calls.at(-1)![1]);
    vi.mocked(files.pickFileToOpen).mockResolvedValue({ text, fileName: 'tree.ost', handle: null });
    expect(await doc.openFile()).toBe(true);
    expect(tree.roots.map(n => n.title)).toEqual(['Second', 'Meal-planning app', 'Third']);
    expect(doc.dirty).toBe(false);
  });

  it('re-orders sub-projects among sub-projects only, outcomes staying first', async () => {
    const { doc, tree, drop, x, subs, stored } = await setup();
    const children = () => tree.nodes.filter(n => n.parent === 'project-1').map(n => n.title);
    expect(children()).toEqual([OUTCOME, 'Another outcome', 'Sub A', 'Sub B', 'Sub C']);

    // Dragged left past both outcomes: first among the sub-projects, still after the outcomes.
    expect(await drop('Sub C', x(OUTCOME) - 1)).toBe(true);
    expect(subs()).toEqual(['Sub C', 'Sub A', 'Sub B']);
    expect(children()).toEqual([OUTCOME, 'Another outcome', 'Sub C', 'Sub A', 'Sub B']);
    expect(stored(1)).toEqual(['Sub C', 'Sub A', 'Sub B']);
    expect(stored(null)).toEqual(['Meal-planning app', 'Second', 'Third']);
    expect(doc.dirty).toBe(true);
  });

  it('with the picker on one project, that project stays put and its sub-projects still re-order', async () => {
    const { doc, ui, drop, x, subs, top } = await setup();
    ui.setProject('project-1');
    expect(top()).toEqual(['Meal-planning app']);
    expect(await drop('Meal-planning app', x('Meal-planning app') + 5000)).toBeNull();
    expect(doc.dirty).toBe(false);
    expect(await drop('Sub A', x('Sub B') + 1)).toBe(true);
    expect(subs()).toEqual(['Sub B', 'Sub A', 'Sub C']);
    ui.setProject('all');
    expect(top()).toEqual(['Meal-planning app', 'Second', 'Third']);
  });
});
