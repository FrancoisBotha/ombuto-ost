import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EXPORT_PALETTE, parsePigments } from '@/export/palette';

import { DEFAULT_COLOR_LABEL, NODE_COLORS, NODE_COLOR_LABEL, isNodeColor, toNodeColor } from './node-colors';

const themeCss = readFileSync('src/ost/styles/theme.css', 'utf8');
const tokensCss = readFileSync('src/ost/styles/ost-tokens.css', 'utf8');
const nodeVue = readFileSync('src/ost/canvas/OstNode.vue', 'utf8');

// ---- WCAG 2.x contrast ------------------------------------------------------------------------
const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const linear = (value: number) => {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `top` at `alpha` over `under`, as the browser composites it (sRGB). */
const over = (top: string, under: string, alpha: number) =>
  `#${channels(top)
    .map((v, i) =>
      Math.round(v * alpha + channels(under)[i] * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

const AA_TEXT = 4.5;
/** WCAG 1.4.11: a boundary that carries meaning (the border, whose style says "assumption"). */
const AA_GRAPHIC = 3;

const { text, bg } = EXPORT_PALETTE;

/** Every text / background pair a coloured node draws (OstNode.vue, "a colour of the user's own"). */
function pairs(name: (typeof NODE_COLORS)[number]) {
  const { fill, edge } = EXPORT_PALETTE.tints[name];
  return {
    title: contrast(text, fill),
    // Type label and "40% confidence": the text colour at 90% over the fill.
    quiet: contrast(over(text, fill, 0.9), fill),
    // Status chips: inverted (good), outlined (in flight), sunk into the fill (bad).
    badgeGood: contrast(fill, text),
    badgeFlight: contrast(text, fill),
    badgeBad: contrast(text, over(bg, fill, 0.5)),
    edgeOnFill: contrast(edge, fill),
    edgeOnGround: contrast(edge, bg),
  };
}

describe('node colours', () => {
  it('is a small palette of named colours, each with a label', () => {
    expect(NODE_COLORS).toHaveLength(8);
    expect(new Set(NODE_COLORS).size).toBe(NODE_COLORS.length);
    for (const name of NODE_COLORS) {
      expect(name).toMatch(/^[a-z]+$/);
      expect(NODE_COLOR_LABEL[name]).toMatch(/^[A-Z][a-z]+$/);
    }
    expect(new Set(Object.values(NODE_COLOR_LABEL)).size).toBe(NODE_COLORS.length);
    expect(Object.values(NODE_COLOR_LABEL)).not.toContain(DEFAULT_COLOR_LABEL);
  });

  it('accepts only its own names', () => {
    for (const name of NODE_COLORS) {
      expect(isNodeColor(name)).toBe(true);
      expect(toNodeColor(name)).toBe(name);
    }
    for (const hostile of [
      'red; background:url(https://example.com)',
      '#ff0000',
      'RED',
      ' red',
      'red ',
      'purple',
      'constructor',
      '__proto__',
      'length',
      '0',
      '',
      0,
      1,
      true,
      null,
      undefined,
      {},
      { toString: () => 'red' },
      ['red'],
    ]) {
      expect(isNodeColor(hostile), JSON.stringify(hostile)).toBe(false);
      expect(toNodeColor(hostile)).toBeNull();
    }
  });

  describe('tokens', () => {
    it('theme.css holds a fill and an edge pigment for every colour, and for no other', () => {
      const tints = [...parsePigments(themeCss).keys()].filter(name => name.startsWith('tint-')).sort();
      expect(tints).toEqual(NODE_COLORS.flatMap(name => [`tint-${name}-edge`, `tint-${name}-fill`]).sort());
    });

    it('ost-tokens.css gives every colour its two roles through data-ost-color, and no other value', () => {
      const rules = [...tokensCss.matchAll(/\[data-ost-color='([^']*)'\]\s*\{([^}]*)\}/g)];
      expect(rules.map(rule => rule[1])).toEqual([...NODE_COLORS]);
      for (const [, name, body] of rules) {
        expect(body.replace(/\s+/g, ' ').trim()).toBe(
          `--node-fill: var(--ost-tint-${name}-fill); --node-edge: var(--ost-tint-${name}-edge);`,
        );
      }
    });

    it('no two colours share a fill or an edge', () => {
      const tints = NODE_COLORS.map(name => EXPORT_PALETTE.tints[name]);
      expect(new Set(tints.map(t => t.fill)).size).toBe(NODE_COLORS.length);
      expect(new Set(tints.map(t => t.edge)).size).toBe(NODE_COLORS.length);
    });
  });

  describe('contrast (WCAG 2.x)', () => {
    it.each(NODE_COLORS)('%s: every piece of text on the fill passes AA, and the border reads', name => {
      const p = pairs(name);
      expect(p.title).toBeGreaterThanOrEqual(AA_TEXT);
      expect(p.quiet).toBeGreaterThanOrEqual(AA_TEXT);
      expect(p.badgeGood).toBeGreaterThanOrEqual(AA_TEXT);
      expect(p.badgeFlight).toBeGreaterThanOrEqual(AA_TEXT);
      expect(p.badgeBad).toBeGreaterThanOrEqual(AA_TEXT);
      expect(p.edgeOnFill).toBeGreaterThanOrEqual(AA_GRAPHIC);
      expect(p.edgeOnGround).toBeGreaterThanOrEqual(AA_GRAPHIC);
    });

    it('prints the table (run with --reporter=verbose to read it)', () => {
      const rows = NODE_COLORS.map(name => {
        const { fill, edge } = EXPORT_PALETTE.tints[name];
        const p = pairs(name);
        const n = (value: number) => value.toFixed(2).padStart(5);
        return `${name.padEnd(8)} fill ${fill} edge ${edge}  title ${n(p.title)}  label/metric ${n(p.quiet)}  chip-bad ${n(p.badgeBad)}  edge/fill ${n(p.edgeOnFill)}  edge/ground ${n(p.edgeOnGround)}`;
      });
      console.info(`\nNode colours against text ${text} on ground ${bg}\n${rows.join('\n')}\n`);
      expect(rows).toHaveLength(NODE_COLORS.length);
    });

    it('the node draws its text the way the measurements assume', () => {
      // If these rules change, `pairs` above must change with them.
      const css = nodeVue.replace(/\s+/g, ' ');
      expect(css).toContain('.ost-node[data-ost-color] { background: var(--node-fill); border-color: var(--node-edge);');
      expect(css).toContain('.ost-node[data-ost-color] .ost-node__kicker, .ost-node[data-ost-color] .ost-node__metric { opacity: 0.9; }');
      expect(css).toContain('.ost-node[data-ost-color] .ost-node__badge--good { background: var(--color-text); color: var(--node-fill); }');
      expect(css).toContain(
        '.ost-node[data-ost-color] .ost-node__badge--flight { border-color: var(--node-edge); color: var(--color-text); }',
      );
      expect(css).toContain(
        '.ost-node[data-ost-color] .ost-node__badge--bad { background: color-mix(in srgb, var(--color-bg) 50%, transparent); color: var(--color-text); }',
      );
    });
  });
});
