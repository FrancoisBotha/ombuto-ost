import { describe, expect, it } from 'vitest';

import { node } from '../domain/fixtures.test-util';
import { layoutTree } from '../domain/layout';

import { pinRendered, toFlowNodes } from './canvas-model';

describe('toFlowNodes (only the nodes in view are ever mounted)', () => {
  const nodes = [node('product-1', null), node('outcome-1', 'product-1'), node('outcome-2', 'product-1')];
  const placed = layoutTree(nodes, { roots: ['product-1'], collapsed: {} });

  it('gives a node Vue Flow has not seen the size of its layout box, so culling can leave it unmounted', () => {
    const flow = toFlowNodes(
      nodes,
      placed,
      () => false,
      () => true,
    ) as { id: string; dimensions?: { width: number; height: number } }[];
    for (const n of flow) expect(n.dimensions).toEqual({ width: placed[n.id].w, height: placed[n.id].h });
    expect(flow.every(n => n.dimensions!.width > 0 && n.dimensions!.height > 0)).toBe(true);
  });

  it('leaves the size of a node Vue Flow already has alone (Vue Flow measured it)', () => {
    const flow = toFlowNodes(
      nodes,
      placed,
      () => false,
      id => id === 'outcome-2',
    ) as { id: string; dimensions?: unknown }[];
    expect(flow.map(n => 'dimensions' in n)).toEqual([false, false, true]);
    expect(toFlowNodes(nodes, placed).some(n => 'dimensions' in n)).toBe(false);
  });
});

describe('pinRendered (keep only the edited node rendered under visibility culling)', () => {
  const graph = (...ids: string[]) => new Map(ids.map(id => [id, { dragging: false }]));

  it('flags the nodes with a rename field or + menu open, and only those', () => {
    const nodes = graph('a', 'b', 'c');
    pinRendered(id => nodes.get(id), new Set(), new Set(['b']), null);
    expect([...nodes].filter(([, n]) => n.dragging).map(([id]) => id)).toEqual(['b']);
  });

  it('unflags a node once its edit ends, and moves the flag to the next edited node', () => {
    const nodes = graph('a', 'b');
    pinRendered(id => nodes.get(id), new Set(), new Set(['a']), null);
    pinRendered(id => nodes.get(id), new Set(['a']), new Set(['b']), null);
    expect(nodes.get('a')!.dragging).toBe(false);
    expect(nodes.get('b')!.dragging).toBe(true);
    pinRendered(id => nodes.get(id), new Set(['b']), new Set(), null);
    expect(nodes.get('b')!.dragging).toBe(false);
  });

  it('leaves the flag of the node really being dragged alone', () => {
    const nodes = graph('a');
    pinRendered(id => nodes.get(id), new Set(), new Set(['a']), null);
    pinRendered(id => nodes.get(id), new Set(['a']), new Set(), 'a');
    expect(nodes.get('a')!.dragging).toBe(true);
  });

  it('skips nodes Vue Flow does not know yet (a new node is pinned on the next sync)', () => {
    const nodes = graph('a');
    expect(() => pinRendered(id => nodes.get(id), new Set(['gone']), new Set(['new']), null)).not.toThrow();
    nodes.set('new', { dragging: false });
    pinRendered(id => nodes.get(id), new Set(['new']), new Set(['new']), null);
    expect(nodes.get('new')!.dragging).toBe(true);
  });
});
