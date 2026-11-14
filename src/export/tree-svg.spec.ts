import { describe, expect, it } from 'vitest';

import { layoutTree } from '@/ost/domain/layout';
import { node, sampleNodes } from '@/ost/domain/fixtures.test-util';
import { TYPE_BOX } from '@/ost/domain/rules';

import { EXPORT_PALETTE } from './palette';
import { DEFAULT_PADDING, treeToSvg } from './tree-svg';

const draw = (...args: Parameters<typeof treeToSvg>) => {
  const result = treeToSvg(...args);
  if (!result) throw new Error('nothing drawn');
  return result;
};

const count = (text: string, part: string) => text.split(part).length - 1;

/** Tags must nest and close: a cheap well-formedness check that needs no XML parser. */
function assertBalanced(svg: string) {
  const open: string[] = [];
  for (const [, closing, name, selfClosing] of svg.matchAll(/<(\/?)([a-zA-Z]+)(?:\s[^<>]*?)?(\/?)>/g)) {
    if (selfClosing) continue;
    if (closing) expect(open.pop()).toBe(name);
    else open.push(name);
  }
  expect(open).toEqual([]);
}

describe('treeToSvg', () => {
  it('returns null when there is nothing to draw', () => {
    expect(treeToSvg([], [])).toBeNull();
    expect(treeToSvg(sampleNodes(), [])).toBeNull();
    expect(treeToSvg(sampleNodes(), ['product-404'])).toBeNull();
  });

  it('is a standalone SVG document sized to the tree plus padding', () => {
    const nodes = [node('product-1', null)];
    const { svg, width, height } = draw(nodes, ['product-1']);
    expect(width).toBe(TYPE_BOX.product.w + 2 * DEFAULT_PADDING);
    expect(height).toBe(TYPE_BOX.product.h + 2 * DEFAULT_PADDING);
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    assertBalanced(svg);
  });

  it('honours the padding option and names the image', () => {
    const { svg, width } = draw([node('product-1', null)], ['product-1'], { padding: 10, title: 'Road <map>' });
    expect(width).toBe(TYPE_BOX.product.w + 20);
    expect(svg).toContain('<title>Road &lt;map&gt;</title>');
  });

  it('draws every node of the view and an edge to each child, whatever is collapsed on screen', () => {
    const nodes = sampleNodes();
    const { svg } = draw(nodes, ['product-1', 'product-2']);
    // background + one frame per node + one per status badge
    const withStatus = nodes.filter(n => n.status && n.type !== 'product').length;
    expect(count(svg, '<rect')).toBe(1 + nodes.length + withStatus);
    expect(count(svg, '<path')).toBe(nodes.filter(n => n.parent).length);
    for (const n of nodes) expect(svg).toContain(`>${n.title}</text>`);
    assertBalanced(svg);
  });

  it('draws only the products of the current view', () => {
    const { svg } = draw(sampleNodes(), ['product-2']);
    expect(svg).toContain('>Title product-2</text>');
    expect(svg).not.toContain('Title product-1');
    expect(svg).not.toContain('<path');
  });

  it('uses the layout of the canvas for positions and edges', () => {
    const nodes = sampleNodes();
    const placed = layoutTree(nodes, { roots: ['product-1'], collapsed: {} });
    const { svg, width } = draw(nodes, ['product-1']);
    const parent = placed['product-1'];
    const child = placed['outcome-1'];
    expect(svg).toContain(`d="M ${parent.x} ${parent.h} V ${parent.h + (child.y - parent.h) / 2} H ${child.x} V ${child.y}"`);
    const boxes = Object.values(placed);
    const left = Math.min(...boxes.map(p => p.x - p.w / 2));
    const right = Math.max(...boxes.map(p => p.x + p.w / 2));
    expect(width).toBe(Math.ceil(right - left + 2 * DEFAULT_PADDING));
  });

  it('styles edges by the type of the child', () => {
    const { svg } = draw(sampleNodes(), ['product-1']);
    const { accent, neutral } = EXPORT_PALETTE;
    expect(svg).toContain(`stroke="${accent[600]}" stroke-width="1.6"/>`);
    expect(svg).toContain(`stroke="${accent[600]}" stroke-width="1.1"/>`);
    expect(svg).toContain(`stroke="${accent[600]}" stroke-width="1.1" stroke-dasharray="4 4"/>`);
    expect(svg).toContain(`stroke="${neutral[700]}" stroke-width="1.1" stroke-dasharray="4 4"/>`);
  });

  it('shows the type label, the status, the confidence and the value as on the canvas', () => {
    const nodes = [
      node('product-1', null),
      node('outcome-1', 'product-1'),
      node('opportunity-1', 'outcome-1', { status: 'exploring', priority: 80, value: 4 }),
      node('solution-1', 'opportunity-1', { status: 'shipped' }),
      node('assumption-1', 'solution-1', { status: 'refuted', conf: 35 }),
      node('evidence-1', 'assumption-1'),
    ];
    const { svg } = draw(nodes, ['product-1']);
    for (const label of ['PRODUCT', 'OUTCOME', 'OPPORTUNITY', 'SOLUTION', 'ASSUMPTION', 'EVIDENCE'])
      expect(svg).toContain(`>${label}</text>`);
    for (const status of ['EXPLORING', 'SHIPPED', 'REFUTED']) expect(svg).toContain(`>${status}</text>`);
    expect(svg).toContain('35%');
    expect(svg).toContain('confidence');
    const { accent, neutral } = EXPORT_PALETTE;
    expect(svg).toContain(`<tspan fill="${accent[300]}">$$$$</tspan><tspan fill="${neutral[700]}">$</tspan>`);
    // five priority dots, on the opportunity only
    expect(count(svg, '<circle')).toBe(5);
    // the evidence title is italic, the assumption frame dashed
    expect(count(svg, 'font-style="italic"')).toBe(1);
    expect(count(svg, 'stroke-dasharray="4 3"')).toBe(1);
  });

  it('leaves out the status row of a node without a status', () => {
    const { svg } = draw([node('product-1', null), node('outcome-1', 'product-1')], ['product-1']);
    expect(count(svg, '<rect')).toBe(3);
  });

  it('is self-contained: literal colours, no stylesheet, no external reference', () => {
    const { svg } = draw(sampleNodes(), ['product-1', 'product-2']);
    expect(svg).not.toMatch(/var\(|oklch|color-mix|url\(|href|@import|<style|<image|<foreignObject|<script/i);
    const colours = [...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map(match => match[1]);
    expect(colours.length).toBeGreaterThan(20);
    for (const colour of colours) expect(colour).toMatch(/^(#[0-9a-f]{6}|none)$/);
    // The only URL in the file is the SVG namespace.
    expect(svg.match(/https?:\/\/[^"\s<]+/g)).toEqual(['http://www.w3.org/2000/svg']);
    expect(svg).toContain('font-family="Inter, system-ui,');
    expect(svg).toContain('sans-serif"');
  });

  it('writes user text as inert, escaped text', () => {
    const nodes = [
      node('product-1', null, { title: '</text><script>alert(1)</script>' }),
      node('outcome-1', 'product-1', { title: 'A & B "quoted" <img src=x onerror=alert(1)>' }),
    ];
    const { svg } = draw(nodes, ['product-1'], { title: ']]></title><script>' });
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&lt;/text&gt;&lt;script&gt;');
    expect(svg).toContain('A &amp; B &quot;quoted&quot;');
    expect(svg).toContain('<title>]]&gt;&lt;/title&gt;&lt;script&gt;</title>');
    expect(count(svg, '<text')).toBe(count(svg, '</text>'));
    assertBalanced(svg);
  });

  it('drops characters that would make the file unreadable', () => {
    const { svg } = draw([node('product-1', null, { title: 'Bad\u0000 \u0007char￾' })], ['product-1']);
    expect(svg).toContain('>Bad char</text>');
  });

  it('wraps a long title to the lines the canvas allows and truncates the rest', () => {
    const long = 'A very long title that goes on and on well past anything that could fit inside one small node box on the canvas';
    const titleLines = (type: string) => {
      const nodes = [
        node('product-1', null),
        node('outcome-1', 'product-1'),
        node('opportunity-1', 'outcome-1'),
        node('solution-1', 'opportunity-1'),
      ];
      nodes.find(n => n.type === type)!.title = long;
      const { svg } = draw(nodes, ['product-1']);
      return [...svg.matchAll(/font-size="15" font-weight="600" fill="[^"]+">([^<]*)<\/text>/g)]
        .map(m => m[1])
        .filter(line => !line.startsWith('Title'));
    };
    const outcome = titleLines('outcome');
    expect(outcome).toHaveLength(3);
    expect(outcome[0]).toMatch(/^A very long title/);
    expect(outcome[2].endsWith('…')).toBe(true);
    expect(titleLines('solution')).toHaveLength(2);
    expect(titleLines('product')).toHaveLength(2);
  });

  it('breaks a title with no spaces rather than let it run out of the box', () => {
    const { svg } = draw([node('product-1', null, { title: 'x'.repeat(200) })], ['product-1'], { measure: text => text.length * 10 });
    const lines = [...svg.matchAll(/font-weight="600" fill="[^"]+">(x+…?)<\/text>/g)].map(m => m[1]);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.length * 10).toBeLessThanOrEqual(TYPE_BOX.product.w);
  });

  it('grows a node whose text needs more room than its layout box, and the image with it', () => {
    const long = 'word '.repeat(40);
    const short = draw([node('product-1', null), node('outcome-1', 'product-1')], ['product-1']);
    const tall = draw([node('product-1', null), node('outcome-1', 'product-1', { title: long })], ['product-1']);
    expect(tall.height).toBeGreaterThan(short.height);
  });

  it('wraps the confidence beside a wide status badge instead of overflowing', () => {
    const nodes = [
      node('product-1', null),
      node('outcome-1', 'product-1'),
      node('opportunity-1', 'outcome-1', { status: 'exploring' }),
      node('solution-1', 'opportunity-1', { status: 'candidate' }),
      node('assumption-1', 'solution-1', { status: 'supported', conf: 80 }),
    ];
    const { svg } = draw(nodes, ['product-1'], { measure: (text, font) => text.length * font.size * 0.62 });
    expect(svg).toContain('>80%</text>');
    expect(svg).toContain('>confidence</text>');
  });

  it('stays quick on a large tree', () => {
    const nodes = [node('product-1', null), node('outcome-1', 'product-1')];
    for (let i = 1; i <= 2000; i++)
      nodes.push(node(`opportunity-${i}`, i % 10 === 1 ? 'outcome-1' : `opportunity-${i - 1}`, { status: 'exploring' }));
    const { svg } = draw(nodes, ['product-1']);
    expect(count(svg, '<path')).toBe(2001);
  });
});
