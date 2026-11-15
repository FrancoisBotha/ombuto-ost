import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AutosaveRecord } from '@/doc/autosave';
import { parseDocument, serializeDocument } from '@/doc/document';
import * as files from '@/doc/file-access';
import { smallDocument } from '@/doc/small-document.test-util';

import { node } from '../domain/fixtures.test-util';
import { GAP_X, ROW_PITCH, layoutTree } from '../domain/layout';
import { TYPE_BOX } from '../domain/rules';
import type { OstNode } from '../domain/types';
import { setupShellStores } from '../shell/shell.test-util';

import { LEVEL_TOLERANCE, reorderDrop, siblingRow } from './drag-reorder';

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

describe('siblingRow', () => {
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

describe('a drag reorder reaches the document', () => {
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
    /** What the canvas does on a drop: decide, and write only when the order changes. */
    const drop = async (title: string, centreX: number, dy = 0) => {
      const row = siblingRow(key(title), tree.nodes, tree.placed);
      const place = row && reorderDrop(row, centreX, dy);
      return place ? tree.moveNode(key(title), tree.byId(key(title))!.parent, place.position) : null;
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

  it('a drop that changes nothing writes nothing: the document stays clean', async () => {
    const { doc, drop, x, top } = await setup();
    expect(await drop('Second', x('Second') + 40)).toBeNull();
    expect(await drop('Meal-planning app', x('Meal-planning app') - 900)).toBeNull();
    expect(await drop('Third', x('Meal-planning app') - 1, ROW_PITCH)).toBeNull(); // not level
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
