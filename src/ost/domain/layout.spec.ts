import { describe, expect, it } from 'vitest';

import { orderTree } from './derive';
import { bigTreeDtos, node, sampleNodes } from './fixtures.test-util';
import { GAP_X, type Placed, ROW_PITCH, edgePath, layoutTree } from './layout';
import { fromDto } from './mapping';
import { TYPE_BOX } from './rules';
import type { OstNode } from './types';

describe('OST tidy layout', () => {
  const nodes = sampleNodes();
  const placed = layoutTree(nodes, { roots: ['project-1', 'project-2'], collapsed: {} });

  it('places every node reachable from the roots, one row per depth', () => {
    expect(Object.keys(placed).sort()).toEqual(nodes.map(n => n.id).sort());
    expect(placed['project-1'].y).toBe(0);
    expect(placed['outcome-1'].y).toBe(ROW_PITCH);
    expect(placed['evidence-2'].y).toBe(5 * ROW_PITCH);
    expect(placed['evidence-2'].depth).toBe(5);
  });

  it('uses the type box for width and height', () => {
    for (const n of nodes) {
      expect(placed[n.id].w).toBe(TYPE_BOX[n.type].w);
      expect(placed[n.id].h).toBe(TYPE_BOX[n.type].h);
    }
  });

  it('centres each parent over the span of its first and last child', () => {
    const kids = (id: string) => nodes.filter(n => n.parent === id).map(n => placed[n.id].x);
    for (const n of nodes) {
      const xs = kids(n.id);
      if (xs.length) expect(placed[n.id].x).toBeCloseTo((xs[0] + xs[xs.length - 1]) / 2);
    }
  });

  it('lays leaves left to right in array order without overlap', () => {
    const leaves = ['opportunity-2', 'assumption-1', 'assumption-2', 'evidence-2', 'evidence-1', 'project-2'];
    const xs = leaves.map(id => placed[id]);
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i].x - xs[i].w / 2 - (xs[i - 1].x + xs[i - 1].w / 2);
      expect(gap).toBeGreaterThanOrEqual(GAP_X);
    }
    // First leaf starts at the origin.
    expect(placed['opportunity-2'].x - placed['opportunity-2'].w / 2).toBe(0);
  });

  it('keeps nodes on one row from overlapping', () => {
    const byRow = new Map<number, { l: number; r: number }[]>();
    for (const p of Object.values(placed)) {
      const row = byRow.get(p.y) ?? [];
      row.push({ l: p.x - p.w / 2, r: p.x + p.w / 2 });
      byRow.set(p.y, row);
    }
    for (const row of byRow.values()) {
      row.sort((a, b) => a.l - b.l);
      for (let i = 1; i < row.length; i++) expect(row[i].l).toBeGreaterThanOrEqual(row[i - 1].r);
    }
  });

  it('leaves an 80px gutter between root branches', () => {
    const lastLeaf = placed['evidence-1'];
    const project2 = placed['project-2'];
    expect(project2.x - project2.w / 2).toBe(lastLeaf.x + lastLeaf.w / 2 + GAP_X + 80);
  });

  it('hides the children of collapsed nodes and treats them as leaves', () => {
    const collapsed = layoutTree(nodes, { roots: ['project-1'], collapsed: { 'solution-1': true } });
    expect(collapsed['solution-1']).toBeDefined();
    expect(collapsed['assumption-1']).toBeUndefined();
    expect(collapsed['evidence-2']).toBeUndefined();
    expect(collapsed['project-2']).toBeUndefined();
  });

  it('ignores unknown roots and lays out only the scoped project', () => {
    const scoped = layoutTree([...nodes, node('outcome-9', 'project-2')], { roots: ['project-2', 'project-404'], collapsed: {} });
    expect(Object.keys(scoped).sort()).toEqual(['outcome-9', 'project-2']);
    expect(scoped['project-2'].x).toBe(scoped['outcome-9'].x);
  });

  describe('projects inside projects', () => {
    // project-1 > (outcome-1 > opportunity-1, project-2 > (outcome-2, outcome-3, project-3 > outcome-4), project-4); project-5
    const nested = orderTree([
      node('project-5', null, { sortOrder: 1 }),
      node('project-4', 'project-1', { sortOrder: 1 }),
      node('project-3', 'project-2'),
      node('outcome-4', 'project-3'),
      node('project-2', 'project-1', { sortOrder: 0 }),
      node('outcome-3', 'project-2', { sortOrder: 1 }),
      node('outcome-2', 'project-2', { sortOrder: 0 }),
      node('opportunity-1', 'outcome-1'),
      node('outcome-1', 'project-1'),
      node('project-1', null, { sortOrder: 0 }),
    ]);
    const at = layoutTree(nested, { roots: ['project-1', 'project-5'], collapsed: {} });
    const left = (id: string) => at[id].x - at[id].w / 2;
    const right = (id: string) => at[id].x + at[id].w / 2;

    it("puts a sub-project one row below its parent project, on the row of the parent's own outcomes", () => {
      expect(Object.keys(at).sort()).toEqual(nested.map(n => n.id).sort());
      expect(at['project-1'].depth).toBe(0);
      for (const id of ['outcome-1', 'project-2', 'project-4']) expect(at[id].y, id).toBe(ROW_PITCH);
      for (const id of ['opportunity-1', 'outcome-2', 'outcome-3', 'project-3']) expect(at[id].y, id).toBe(2 * ROW_PITCH);
      expect(at['outcome-4'].y).toBe(3 * ROW_PITCH);
      expect(at['project-3']).toMatchObject({ w: TYPE_BOX.project.w, h: TYPE_BOX.project.h });
    });

    it("lays a project's own outcomes to the left of its sub-projects, each over its own subtree", () => {
      // Row 1, left to right: the outcome, then the sub-projects in their order.
      expect(right('outcome-1')).toBeLessThan(left('project-2'));
      expect(right('project-2')).toBeLessThan(left('project-4'));
      // Row 2: the outcomes of the sub-project before its own sub-project.
      expect(right('outcome-2') + GAP_X).toBeLessThanOrEqual(left('outcome-3'));
      expect(right('outcome-3')).toBeLessThan(left('project-3'));
      // A parent is centred over its first and last child, whatever their types.
      expect(at['project-2'].x).toBeCloseTo((at['outcome-2'].x + at['project-3'].x) / 2);
      expect(at['project-1'].x).toBeCloseTo((at['outcome-1'].x + at['project-4'].x) / 2);
      expect(at['project-3'].x).toBe(at['outcome-4'].x);
    });

    it('never overlaps two boxes, on any row', () => {
      // Leaves are a full gutter apart. A box centred over a narrower child reaches a few pixels
      // into the gutter (a 244px project over a 238px outcome: 3px), so boxes only have to stay clear.
      const boxes = Object.entries(at);
      let pairs = 0;
      for (const [a, p] of boxes) {
        for (const [b, q] of boxes) {
          if (a >= b || p.y !== q.y) continue;
          pairs++;
          expect(Math.abs(p.x - q.x) - (p.w + q.w) / 2, `${a} / ${b}`).toBeGreaterThanOrEqual(GAP_X - 6);
        }
      }
      expect(pairs).toBeGreaterThan(5);
      // Rows are further apart than the tallest box.
      expect(ROW_PITCH).toBeGreaterThan(Math.max(...Object.values(TYPE_BOX).map(box => box.h)));
    });

    it('a focused sub-project is laid out as the top of its own subtree, and nothing else', () => {
      const focused = layoutTree(nested, { roots: ['project-2'], collapsed: {} });
      expect(Object.keys(focused).sort()).toEqual(['outcome-2', 'outcome-3', 'outcome-4', 'project-2', 'project-3']);
      expect(focused['project-2']).toMatchObject({ y: 0, depth: 0 });
      expect(focused['outcome-4'].y).toBe(2 * ROW_PITCH);
      expect(left('outcome-2')).toBeGreaterThan(0);
      expect(focused['outcome-2'].x - focused['outcome-2'].w / 2).toBe(0);
    });

    it('a collapsed sub-project hides everything inside it', () => {
      const collapsed = layoutTree(nested, { roots: ['project-1'], collapsed: { 'project-2': true } });
      expect(Object.keys(collapsed).sort()).toEqual(['opportunity-1', 'outcome-1', 'project-1', 'project-2', 'project-4']);
    });
  });

  it('draws an orthogonal three-segment edge from parent bottom-centre to child top-centre', () => {
    const parent = { x: 100, y: 0, w: 200, h: 60, depth: 0 };
    const child = { x: 40, y: 156, w: 200, h: 92, depth: 1 };
    expect(edgePath(parent, child)).toBe('M 100 60 V 108 H 40 V 156');
  });

  describe('large trees', () => {
    /** The plain O(n^2) form of the algorithm, kept as the reference the map-based layout must match. */
    function referenceLayout(list: OstNode[], opts: { roots: string[]; collapsed: Record<string, boolean> }) {
      const pos: Record<string, Placed> = {};
      const childrenOf = (id: string) => list.filter(n => n.parent === id);
      let cursor = 0;
      const walk = (n: OstNode, depth: number): number => {
        const box = TYPE_BOX[n.type];
        const kids = opts.collapsed[n.id] ? [] : childrenOf(n.id);
        let cx: number;
        if (!kids.length) {
          cx = cursor + box.w / 2;
          cursor += box.w + GAP_X;
        } else {
          const spans = kids.map(k => walk(k, depth + 1));
          cx = (spans[0] + spans[spans.length - 1]) / 2;
        }
        pos[n.id] = { x: cx, y: depth * ROW_PITCH, w: box.w, h: box.h, depth };
        return cx;
      };
      for (const rootId of opts.roots) {
        const root = list.find(n => n.id === rootId);
        if (root) {
          walk(root, 0);
          cursor += 80;
        }
      }
      return pos;
    }

    const big = bigTreeDtos(3, 25).map(fromDto);
    const roots = big.filter(n => n.type === 'project').map(n => n.id);

    it('matches the reference layout exactly', () => {
      expect(big.length).toBeGreaterThan(300);
      const collapsed = { [big.find(n => n.type === 'solution')!.id]: true };
      expect(layoutTree(big, { roots, collapsed: {} })).toEqual(referenceLayout(big, { roots, collapsed: {} }));
      expect(layoutTree(big, { roots, collapsed })).toEqual(referenceLayout(big, { roots, collapsed }));
    });

    it('lays out 300+ nodes quickly', () => {
      const started = performance.now();
      for (let i = 0; i < 20; i++) layoutTree(big, { roots, collapsed: {} });
      expect((performance.now() - started) / 20).toBeLessThan(25);
    });
  });
});
