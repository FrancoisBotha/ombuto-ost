import { describe, expect, it } from 'vitest';

import { EXPORT_PALETTE, buildPalette, oklchToHex, parsePigments, priorityHex } from './palette';

const HEX = /^#[0-9a-f]{6}$/;

describe('export palette', () => {
  it('resolves every role to a literal colour from theme.css', () => {
    const colours = [
      EXPORT_PALETTE.bg,
      EXPORT_PALETTE.surface,
      EXPORT_PALETTE.text,
      ...Object.values(EXPORT_PALETTE.accent),
      ...Object.values(EXPORT_PALETTE.neutral),
    ];
    expect(colours).toHaveLength(21);
    for (const colour of colours) expect(colour).toMatch(HEX);
    expect(EXPORT_PALETTE.accent[600]).not.toBe(EXPORT_PALETTE.accent[500]);
  });

  it('reads the pigments of a stylesheet', () => {
    const pigments = parsePigments(':root { --ost-accent-100: #F5F4FF; --ost-nocturne-ground:#161826; --other: #000000; }');
    expect([...pigments]).toEqual([
      ['accent-100', '#f5f4ff'],
      ['nocturne-ground', '#161826'],
    ]);
  });

  it('says which colour is missing from a theme', () => {
    expect(() => buildPalette(':root { --ost-nocturne-ground: #161826; }')).toThrow(/nocturne-surface/);
  });
});

describe('oklchToHex', () => {
  it('converts the reference colours', () => {
    expect(oklchToHex(1, 0, 0)).toBe('#ffffff');
    expect(oklchToHex(0, 0, 0)).toBe('#000000');
    expect(oklchToHex(0.62796, 0.25768, 29.2339)).toBe('#ff0000');
    expect(oklchToHex(0.45201, 0.31321, 264.052)).toBe('#0000ff');
  });

  it('clips colours outside sRGB', () => {
    expect(oklchToHex(0.9, 0.4, 140)).toMatch(HEX);
  });
});

describe('priorityHex', () => {
  it('gives a literal colour across the whole range, cool for low and warm for high', () => {
    for (const p of [0, 1, 50, 100, 250]) expect(priorityHex(p)).toMatch(HEX);
    const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const [lowRed, , lowBlue] = channels(priorityHex(1));
    const [highRed, , highBlue] = channels(priorityHex(100));
    expect(lowBlue).toBeGreaterThan(lowRed);
    expect(highRed).toBeGreaterThan(highBlue);
  });
});
