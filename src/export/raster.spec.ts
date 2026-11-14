import { describe, expect, it } from 'vitest';

import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE, MIN_PNG_SCALE, PNG_SCALE, rasterScale, svgDataUrl } from './raster';

describe('rasterScale', () => {
  it('rasterises an ordinary tree at 2x', () => {
    expect(PNG_SCALE).toBe(2);
    expect(rasterScale(1686, 956)).toBe(2);
    expect(rasterScale(3000, 2000)).toBe(2);
  });

  it('reduces the scale so that neither side goes past the canvas limit', () => {
    const scale = rasterScale(12000, 400);
    expect(scale).toBeLessThan(2);
    expect(scale).toBeGreaterThanOrEqual(MIN_PNG_SCALE);
    expect(12000 * scale).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
    expect(rasterScale(400, 12000)).toBe(scale);
  });

  it('reduces the scale so that the area stays within the canvas limit', () => {
    const scale = rasterScale(6000, 4000);
    expect(scale).toBeLessThan(2);
    expect(6000 * scale * 4000 * scale).toBeLessThanOrEqual(MAX_CANVAS_AREA * 1.000001);
  });

  it('refuses, in plain words, a tree too large for a readable image', () => {
    expect(() => rasterScale(40000, 900)).toThrow('This tree is too large to export as a PNG image. Export it as SVG instead');
    expect(() => rasterScale(12000, 12000)).toThrow(/too large/);
  });

  it('refuses an empty image', () => {
    expect(() => rasterScale(0, 100)).toThrow('There is nothing to export.');
    expect(() => rasterScale(100, Number.NaN)).toThrow('There is nothing to export.');
  });
});

describe('svgDataUrl', () => {
  it('is a data URL that round-trips the markup', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>a # b % ć 😀</text></svg>';
    const url = svgDataUrl(svg);
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(url).not.toMatch(/[#<>" ]/);
    expect(decodeURIComponent(url.slice(url.indexOf(',') + 1))).toBe(svg);
  });
});
