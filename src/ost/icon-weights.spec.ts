import { describe, expect, it } from 'vitest';

/**
 * Every Phosphor icon is drawn in the regular weight (8-unit arcs on the 256 grid, stroke-width
 * 16). No OST component may use bold.
 */
const sources = import.meta.glob('./**/*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('Phosphor icon weights', () => {
  it('finds the OST components', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(15);
  });

  it('never uses the bold weight', () => {
    const bold = Object.entries(sources)
      .filter(([, src]) => /weight="bold"|weight:\s*'bold'/.test(src))
      .map(([file]) => file);
    expect(bold).toEqual([]);
  });
});
