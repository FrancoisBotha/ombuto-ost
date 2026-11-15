import { describe, expect, it } from 'vitest';

import { mount } from '@vue/test-utils';

import { node } from '../domain/fixtures.test-util';
import type { Placed } from '../domain/layout';

import CanvasMinimap from './CanvasMinimap.vue';

describe('CanvasMinimap (overview map)', () => {
  const nodes = [node('project-1', null), node('outcome-1', 'project-1')];
  const placed: Record<string, Placed> = {
    'project-1': { x: 100, y: 0, w: 200, h: 90 } as Placed,
    'outcome-1': { x: 100, y: 156, w: 200, h: 90 } as Placed,
  };
  const mountMap = () =>
    mount(CanvasMinimap, {
      props: { nodes, placed, selectedId: null, viewport: { x: 0, y: 0, zoom: 1 }, size: { width: 800, height: 600 } },
    });

  it('is a labelled group with an "overview map" role description', () => {
    const map = mountMap().get('[data-cy="ost-minimap"]');
    expect(map.attributes('role')).toBe('group');
    expect(map.attributes('aria-roledescription')).toBe('overview map');
    expect(map.attributes('aria-label')).toBe('Overview map: click or drag to recentre the canvas, scroll to zoom');
  });

  it('draws a node in the colour it was given, and the others by type', () => {
    const w = mount(CanvasMinimap, {
      props: {
        nodes: [node('project-1', null, { color: 'teal' }), node('outcome-1', 'project-1', { color: 'url(x)' as never })],
        placed,
        selectedId: null,
        viewport: { x: 0, y: 0, zoom: 1 },
        size: { width: 800, height: 600 },
      },
    });
    const project = w.get('[data-cy="ost-minimap-node-project-1"]');
    expect(project.attributes('data-ost-color')).toBe('teal');
    expect(project.classes()).toContain('ost-minimap__node--project');
    expect(w.get('[data-cy="ost-minimap-node-outcome-1"]').attributes('data-ost-color')).toBeUndefined();
    expect(mountMap().get('[data-cy="ost-minimap-node-project-1"]').attributes('data-ost-color')).toBeUndefined();
  });

  it('draws every laid-out node and the viewport rectangle', () => {
    const w = mountMap();
    expect(w.find('[data-cy="ost-minimap-node-project-1"]').exists()).toBe(true);
    expect(w.find('[data-cy="ost-minimap-node-outcome-1"]').exists()).toBe(true);
    expect(w.find('[data-cy="ost-minimap-view"]').exists()).toBe(true);
  });
});
