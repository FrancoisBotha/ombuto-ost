import { describe, expect, it } from 'vitest';

import { breadcrumb, childrenOf, countByType, descendantIds, evidenceStrength, orderTree, panelTabsFor, statusTone } from './derive';
import { node, sampleNodes } from './fixtures.test-util';

describe('OST derived values', () => {
  const nodes = sampleNodes();

  it('builds the ancestor breadcrumb from the project down, excluding the node', () => {
    expect(breadcrumb('evidence-2', nodes).map(n => n.id)).toEqual([
      'project-1',
      'outcome-1',
      'opportunity-1',
      'solution-1',
      'assumption-3',
    ]);
    expect(breadcrumb('project-1', nodes)).toEqual([]);
    expect(breadcrumb('nope', nodes)).toEqual([]);
  });

  it('counts descendants and lists children', () => {
    expect(descendantIds('opportunity-1', nodes)).toHaveLength(7);
    expect(descendantIds('project-2', nodes)).toEqual([]);
    expect(descendantIds('solution-1', nodes).sort()).toEqual(['assumption-1', 'assumption-2', 'assumption-3', 'evidence-2']);
    expect(childrenOf('solution-1', nodes).map(n => n.id)).toEqual(['assumption-1', 'assumption-2', 'assumption-3']);
  });

  it('survives a parent cycle', () => {
    const cyclic = [node('opportunity-1', 'opportunity-2'), node('opportunity-2', 'opportunity-1')];
    expect(breadcrumb('opportunity-1', cyclic).map(n => n.id)).toEqual(['opportunity-2']);
    expect(descendantIds('opportunity-1', cyclic)).toEqual(['opportunity-2']);
  });

  it('derives solution evidence strength through the rules', () => {
    expect(evidenceStrength('solution-1', nodes).score).toBe(53);
  });

  it('orders a shuffled list into tree pre-order', () => {
    const shuffled = [...nodes].reverse();
    const ordered = orderTree(shuffled).map(n => n.id);
    expect(ordered[0]).toBe('project-1');
    expect(ordered.at(-1)).toBe('project-2');
    // opportunity-1's children grouped: opportunity, solution, evidence
    const kids = ordered.filter(id => nodes.find(n => n.id === id)?.parent === 'opportunity-1');
    expect(kids).toEqual(['opportunity-2', 'solution-1', 'evidence-1']);
    // each node comes after its parent
    for (const n of nodes) if (n.parent) expect(ordered.indexOf(n.id)).toBeGreaterThan(ordered.indexOf(n.parent));
  });

  it('counts nodes by type', () => {
    expect(countByType(nodes)).toEqual({ project: 2, outcome: 1, opportunity: 2, solution: 1, assumption: 3, evidence: 2 });
  });

  it('adapts panel tabs by type and maps statuses to three tones', () => {
    expect(panelTabsFor('project')).toEqual(['detail', 'links']);
    expect(panelTabsFor('opportunity')).toEqual(['detail', 'links', 'questions']);
    expect(panelTabsFor('solution')).toEqual(['detail', 'links']);
    expect(['validated', 'testing', 'parked'].map(statusTone)).toEqual(['good', 'flight', 'bad']);
  });
});
